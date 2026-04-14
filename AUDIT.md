# Anon Addon — Audit Findings (2026-04-15)

> **Audited:** `/Users/15x/Downloads/WORKING/addons-me/anon` — Pumble anonymous-messaging bot.
> **Method:** Three parallel Explore-agent passes (architecture, performance/DB, security/tests) followed by manual verification of every "critical" and "high" claim against the source. False positives have been removed; only verified findings appear below. Every finding cites file:line and includes a concrete fix.
>
> **Plan-mode note:** This file lives at `/Users/15x/.claude/plans/sparkling-marinating-flask.md` because plan mode forbids editing other files. After approval, **move it into the repo as `addons-me/anon/AUDIT.md`** and start fixing top-down.

---

## TL;DR — The two product-breaking bugs

The most important findings are not security or theoretical — they are two **silent UPDATE-before-INSERT** bugs that break the addon's headline feature (admin abuse review):

1. **The Report button always shows "(message not available)"** for first-touch messages. The conversation row is `INSERT`ed *after* `anonMessage.send/sendToChannel/replyInThread` already tried to `UPDATE` `last_message`. That UPDATE silently affects 0 rows (the row doesn't exist yet), so `last_message` stays NULL forever. Recipients can still send/receive anon messages, but admins reviewing reports see a placeholder instead of the offending text.

2. **Anonymous channel→thread replies are broken end-to-end.** `sendToChannel` calls `updateThreadRootId(convId, msg.id)` *before* the conv row exists → no-op → `thread_root_id` stays NULL → when the recipient clicks "Reply Anonymously", `anonReplyModal` falls back to `pending.convId` (a UUID) and passes it to `client.v1.messages.reply()` as if it were a real Pumble message ID. The reply API call will reject or thread to nothing.

Both bugs are passed by the test suite because the tests use a fake Pumble client that doesn't simulate the order-of-operations problem and because no test asserts that `last_message` or `thread_root_id` actually got persisted after a successful send. **Test gap, not just a code bug.**

Fix sketch for both: do the `INSERT` *before* calling the Pumble API, and have `anonMessage.send/sendToChannel/replyInThread` write `last_message`/`thread_root_id` against an existing row. Better yet, pass the conv row through and let the service own both the INSERT and UPDATE inside one logical unit (it can't be a SQLite transaction because the Pumble call is async, but ordering alone fixes correctness).

---

## Severity legend

- **Critical** — production-broken or active security risk; fix before anything else
- **High** — wrong behavior or strong defense-in-depth gap; fix this sprint
- **Medium** — observable rough edge or maintenance debt; fix opportunistically
- **Low / Nit** — polish

False positives from the agent passes have been **omitted**. Notable removed claims: "reportChannel inflight cache leaks rejected promises" (the `finally{}` already handles it), "abot/ directory still in repo" (it was consolidated 2026-04-09 — only doc drift remains), "ack delayed past 3s by Pumble post" (ack happens before any external call — verified at `commands/anon.ts:16`).

---

# Critical

## C-1 — `last_message` is never persisted on first send

**Files:** `src/services/anonMessage.ts:98, 107, 119` ; `src/commands/anon.ts:140-141, 185-186, 224-225`

`anonMessage.send` posts to Pumble, then runs `deps.conversations.updateLastMessage(convId, messageText)`. The corresponding `conversations.insert(convId, ...)` only happens **after** `anonMessage.send` returns, in the calling handler in `commands/anon.ts`. Because the row doesn't exist yet, the UPDATE silently affects 0 rows (better-sqlite3 doesn't throw and the code never checks `result.changes`).

Result: `conversations.last_message` is `NULL` for every initial DM, channel post, and thread root. `interactions/reportAnon.ts:79-83` then renders `"(message not available)"` for every report. The whole point of the report flow — letting admins review the offending content — is broken.

**Fix:** Move the `conversations.insert` *before* the Pumble call, and pass `last_message` directly into the insert so there's only one DB statement, not two:

```ts
// commands/anon.ts (handleDm)
deps.repos.conversations.insert(convId, workspaceId, senderId, recipientId, message); // last_message inline
const sent = await deps.anonMessage.send({ ... });   // no longer touches DB
```

Then delete `conversations.updateLastMessage` from the service entirely. (For channel/thread, do the same in `handleChannel` / `handleThread`, and let the Pumble response from `sendToChannel` only update `thread_root_id` — see C-2.) Add a regression test that asserts `conversations.get(convId).last_message === message` after a successful send.

---

## C-2 — `thread_root_id` is never persisted, breaking channel→thread replies

**Files:** `src/services/anonMessage.ts:108-110` ; `src/commands/anon.ts:185-186` ; `src/views/anonReplyModal.ts:153-159`

Same root cause as C-1 but worse downstream impact:

1. `sendToChannel` posts to a channel, gets `msg.id` back, then calls `updateThreadRootId(convId, msg.id)`. The conv row doesn't exist yet → silent no-op → `thread_root_id` is `NULL`.
2. A recipient clicks "Reply Anonymously" on the channel post. `anonReplyModal.ts:154` reads `const threadRoot = conv.thread_root_id ?? pending.convId;` — falls back to the **convId UUID**, which is not a real Pumble message ID.
3. `client.v1.messages.reply(threadRoot, channelId, ...)` is called with a UUID where Pumble expects a `mId`. This either fails outright or threads onto whatever message happens to share the prefix.

**Fix:** As part of C-1, restructure so `insertChannel` runs first and `sendToChannel` returns `msg.id` to the caller, which then runs `updateThreadRootId` against the existing row. Add a regression test: after `sendToChannel`, assert that `conversations.get(convId).thread_root_id === <fake msg id from FakePumbleClient>`. Also assert that `replyInThread` is called with the persisted `thread_root_id`, not the convId.

---

## C-3 — `conversations.get()` is not workspace-scoped

**Files:** `src/db/repos/conversationsRepo.ts:18, 31-32, 44-53`

`get(id)` queries `WHERE id = ?` only; the method signature doesn't even accept a `workspaceId`. Every caller (`reportAnon.ts:49`, `anonReplyModal.ts:65`) reads the row by convId alone. The row *carries* `workspace_id` but no caller verifies it against `ctx.payload.workspaceId`.

Migration 007 made every other table workspace-scoped via composite PKs. `conversations` is the lone exception because the PK is `id` (a UUID).

The realistic exploitation path is narrow — UUIDs are unguessable — but the attack surface is real if a convId leaks (logs, error messages, a future feature). It also creates a clean foot-gun for any future code that queries by convId without re-checking workspace.

**Fix (defense in depth):**

1. Change the repo signature to `get(workspaceId: string, id: string)` and add `AND workspace_id = ?` to the SQL.
2. Update both callers to pass `ctx.payload.workspaceId`.
3. In a follow-up migration (`008_conversations_pk.sql`), change the PK to `(workspace_id, id)` using the same CREATE-copy-drop-rename pattern as 007. This is invasive but it makes cross-workspace lookup a hard error at the schema level.
4. Add a test in `tests/db/conversationsRepo.test.ts` (create the file): insert a row in `ws-1`, attempt `get("ws-2", id)`, assert `undefined`.

---

# High

## H-1 — `audit_log.workspace_id` is nullable and not enforced on insert

**Files:** `src/db/migrations/003_audit_log.sql:8` ; `src/db/repos/auditLogRepo.ts:57-66` ; `src/services/reportChannel.ts:72-75`

`audit_log.workspace_id` is `TEXT` (nullable). `auditLogRepo.record()` writes `entry.workspaceId ?? null`. The only code path that *actually* relies on this nullability is `reportChannel.ts:72-75`, which omits `workspaceId` when channel setup fails — meaning the audit row for a setup failure has no workspace context at all.

This makes the audit table useless for per-workspace forensics in exactly the failure modes that matter most.

**Fix:** Always pass `workspaceId` into `auditLog.record()`. Update `reportChannel.makeReportChannelService` so `doCreate` accepts `workspaceId` (it already does) and threads it into the failure audit row. Then add a migration that backfills NULL → `''` and changes the column to `NOT NULL DEFAULT ''`. Optionally add a runtime assertion in `record()`: `if (!entry.workspaceId) deps.logger.warn(...)`.

---

## H-2 — Pending tokens stored in plaintext, no documented threat-model alignment

**Files:** `src/tokens/sqliteCredentialsStore.ts:43-50, 64-86` ; `src/db/migrations/004_tokens.sql` ; `SECURITY.md`

The `tokens` table stores `access_token` as plain TEXT. This is intentional per `SECURITY.md` ("anyone with read access to the production database can therefore de-anonymize messages"), but the threat model only addresses *message content*, not token theft. If the SQLite file is exfiltrated, the bot JWT and every user JWT are immediately reusable against Pumble's API.

**Fix:** Pick one and do it explicitly:

- **Option A (low-effort, recommended for now):** Document explicitly in `SECURITY.md` that tokens live in plaintext, the DB file must be `chmod 600` and never copied off the host, and operators must rotate via `APP_UNINSTALLED` if the host is compromised. Add a Dockerfile `RUN chmod 700 /app/data` after the chown.
- **Option B (proper fix):** Encrypt `access_token` at rest with AES-256-GCM keyed off a `TOKEN_ENCRYPTION_KEY` env var (32 random bytes, base64). Wrap reads/writes in `tokens/sqliteCredentialsStore.ts`. Rotate by re-encrypting with a new key and updating env. Add tests for round-trip and for "wrong key → cannot decrypt".

Choose A this sprint, B before public marketplace listing.

---

## H-3 — Self-reports are not blocked

**Files:** `src/interactions/reportAnon.ts:59-71`

`reportAnon` extracts `anonSenderId` (the real sender) and `reporterId` (`ctx.payload.userId`) but never checks whether they're the same user. A sender can click Report on their own anonymous message and post their own real identity to the admin-only reports channel.

This isn't an instant compromise (the channel is private to admins), but:

1. It's a **self-doxx vector** — a curious sender clicking Report to "see what happens" tells admins they sent the message.
2. It gives anyone who can read the reports channel a way to verify "did user X send anon message Y?" by waiting for X to click Report.
3. It pollutes the admin queue with non-actionable reports.

**Fix:** Right after the `conv` lookup in `reportAnon.ts:57`, add:

```ts
if (anonSenderId === reporterId) {
  deps.logger.warn({ eventType: "REPORT", convId, outcome: "self-report" }, "self-report ignored");
  deps.auditLog.record({
    eventType: "REPORT", workspaceId: ctx.payload.workspaceId,
    actorId: reporterId, convId, metadata: { outcome: "self-report" },
  });
  await ctx.ack();
  return;
}
```

Add a test in `tests/interactions/reportAnon.test.ts`: insert a conv where `sender_id === reporter`, fire the handler, assert no `postMessageToChannel` call was made and an audit row with outcome `self-report` was written.

---

## H-4 — Retention `runOnce()` is uncaught; one DB error kills purges silently for 6 hours

**Files:** `src/services/retention.ts:53-80, 82-87`

`runOnce` is called immediately at startup and every 6 h via `setInterval`. There's no try/catch. If any of the five `purgeOlderThan` calls throws (locked DB, disk full, transient corruption), the error becomes an unhandled rejection or an uncaught exception that Node logs and continues — but every subsequent purge for that interval cycle is skipped, and the operator will likely never notice until the disk fills.

**Fix:** Wrap `runOnce`'s body in `try/catch`, log the error with structure, and let the next interval tick try again. Also add an `isRunning` guard so a slow purge can't overlap with the next tick:

```ts
let isRunning = false;
const runOnce = (): void => {
  if (isRunning) {
    deps.logger.info({ skipped: "previous run still in flight" }, "retention.skip");
    return;
  }
  isRunning = true;
  try {
    // ... existing body
  } catch (err) {
    deps.logger.error({ err: (err as Error).message }, "retention.purge failed");
  } finally {
    isRunning = false;
  }
};
```

Add a test that injects a repo whose `purgeOlderThan` throws and asserts (a) the scheduler doesn't crash, (b) the next tick still runs.

---

## H-5 — Modal pendingReplies are not deleted on send error

**Files:** `src/views/anonReplyModal.ts:151-188`

After `await deps.anonMessage.send/replyInThread` succeeds, line 167 deletes the pending reply. If the send **throws**, control jumps to the catch on line 178 and the pending row is left in place. The same pending row is then served on the next modal open, which reuses the same convId and sends the reply text the user originally typed.

This is technically the documented "survives crash" behavior, but combined with C-1/C-2 it means a user retrying after a transient Pumble error can end up double-posting (if the first attempt actually went through despite throwing) or stuck repeatedly hitting the same broken conv. There's also no audit row in the catch with outcome `pending-not-cleared`.

**Fix (minimal):** Decide a deletion policy per error class. If the error is from `client.v1.messages.*`, the pending row should stay (retry is the right call). If it's from the rate-limit / block-list / state-validation path, delete the pending row so a stale modal doesn't loop forever. Concretely: leave the current behavior on caught errors, but in the **hard-validation** early returns above (`!replyText`, `replyText.length > MAX_MESSAGE_LENGTH`, `!conv`, `missing-channel-id`), call `await deps.pendingReplies.delete(...)` before returning. Add audit rows with `outcome: "empty"` / `"too-long"` / `"conv-not-found"` for each, matching the pattern at line 110-114 and 123-126.

---

## H-6 — Migration 006 lacks a CHECK on `message_type`

**Files:** `src/db/migrations/006_channel_thread.sql:1`

`message_type TEXT NOT NULL DEFAULT 'dm'` — no constraint. Migration 002 correctly added `CHECK (direction IN ('recipient', 'sender'))` for `pending_replies.direction`; this one was missed. The TypeScript type `MessageType = "dm" | "channel" | "thread"` is the only enforcement, and the runtime trusts the database.

**Fix:** New migration `008_message_type_check.sql` that rebuilds `conversations` with a CHECK constraint (or use a partial index trick). At minimum add a runtime assertion in `conversationsRepo.insertChannel` that `messageType` is one of the three legal values.

---

# Medium

## M-1 — `last_message` not bounded; full 2 KB body persists per conv

**Files:** `src/db/repos/conversationsRepo.ts:34-35` ; `src/services/anonMessage.ts:98, 107, 119` ; `src/interactions/reportAnon.ts:79-82`

Once C-1 is fixed, `last_message` will actually carry the full message text up to `MAX_MESSAGE_LENGTH` (2000). The report flow only ever displays 200 chars (`PREVIEW_MAX_CHARS`). The other 1800 chars are dead weight on disk and in any backup, plus they linger for 90 days in plaintext in a database whose own SECURITY.md acknowledges DB read = full de-anon.

**Fix:** Truncate at insert time to `PREVIEW_MAX_CHARS + ellipsis` (~210 chars). Move the constant to a shared file so the repo and the report renderer agree.

## M-2 — `auditLogRepo.queryStmtCache` is unbounded

**Files:** `src/db/repos/auditLogRepo.ts:54, 99-103`

The cache key is the dynamically-built SQL string. Today's caller surface is small (5–6 distinct shapes), so this is fine in practice, but a future admin endpoint that exposes filter combinations to users could explode the cache.

**Fix:** Either (a) cap the cache at 32 entries with simple LRU eviction, or (b) precompute the 16 possible WHERE-clause combinations at construction time. (b) is the cleaner choice for a fixed filter surface.

## M-3 — Retention scheduler shutdown doesn't wait for in-flight purge

**Files:** `src/services/retention.ts:94-96` ; `src/shutdown.ts`

`stop()` just calls `clearInterval`. better-sqlite3 is synchronous, so a mid-purge call can't be interrupted, but the shutdown handler proceeds to close the DB while a purge is on the call stack from inside Node's timer queue.

**Fix:** Convert `stop` to return a promise that awaits the in-flight `runOnce`:

```ts
let inFlight: Promise<void> | null = null;
const runOnce = async (): Promise<void> => { /* ... */ };
const tick = (): void => { inFlight = runOnce().finally(() => { inFlight = null; }); };
return { stop: async () => { clearInterval(handle); if (inFlight) await inFlight; } };
```

Then `shutdown.ts` should `await deps.retention.stop()` before `db.close()`.

## M-4 — `parseRecipient` accepts any non-`>` characters as user ID

**Files:** `src/services/parseRecipient.ts:16-23`

The regex `^<<@([^>]+)>>` matches `<<@ >>`, `<<@!@#$%^>>`, `<<@x y z>>`, etc. Pumble's API will reject anything that isn't a real user ID, but the bad request happens deep inside the send flow and surfaces to the user as "Something went wrong." rather than "That doesn't look like a user mention."

**Fix:** Tighten to `^<<@([a-z0-9]{16,})>>` (Pumble user IDs are MongoDB ObjectIds — 24 hex chars in practice; 16 is conservative). Update tests in `tests/services/parseRecipient.test.ts`.

## M-5 — Slash-command text not length-bounded before parsing

**Files:** `src/commands/anon.ts:20-21`

`MAX_MESSAGE_LENGTH = 2000` is enforced inside `preflight` (line 56), but the *full text* (including the mention prefix) is parsed and trimmed before that check runs. A 100 KB string would still get parsed and stored in JS memory before being rejected. Pumble's API likely caps the slash-command payload, but the addon shouldn't trust that.

**Fix:** Add a hard cap at the top of the handler: `if (text.length > MAX_MESSAGE_LENGTH * 2) { await ctx.say("Message too long.", "ephemeral"); return; }`

## M-6 — Audit-log gaps in modal validation early returns

**Files:** `src/views/anonReplyModal.ts:36-72`

The `recipient-blocked` and `rate-limited-*` early returns correctly write audit rows; the `no-pending`, `empty`, `too-long`, `conv-not-found`, and `self-reply` early returns only `logger.warn` and skip the audit log. For an audit table to be useful, it must be a complete record of every rejection reason, not a sample.

**Fix:** Add `deps.auditLog.record(...)` to each of the five missing branches, mirroring the existing pattern. Bonus: extract a tiny helper `auditReplyOutcome(deps, workspaceId, userId, convId, outcome)` to dedupe.

## M-7 — Documentation drift across CLAUDE.md, SECURITY.md, SPEC.md

**Files:** `CLAUDE.md` ; `docs/SPEC.md` (table definitions) ; `SECURITY.md` (compromised-credentials block)

- `CLAUDE.md` says "117/117 tests" and "117 tests across 21 files" (line 132 region). Actual count: **26 test files** (verified). Test count is also drifting — re-run and update.
- `docs/SPEC.md §6.1-6.2` shows pre-migration-007 PK shapes. After migration 007 every table except `conversations` is composite-keyed.
- `SECURITY.md:74-80` references the `abot/` directory and live credentials. The directory was consolidated into `anon` on 2026-04-09 (per parent `WORKING/CLAUDE.md`). The credentials still need to be **rotated via the Pumble marketplace** (not done per the parent doc), but the file references are stale.

**Fix:** One sweep through CLAUDE.md, SPEC.md, SECURITY.md. Resolve the test-count claim by running `npm test -- --reporter=verbose` and recording the actual number. Rewrite the SECURITY.md compromised-credentials block to say "rotated 2026-04-XX" once the rotation actually happens.

## M-8 — `INITIAL_SCHEMA_SQL` is the legacy 5-table schema

**Files:** `src/db/connection.ts:14-28` ; `src/db/schema.ts` (assumed) ; `src/db/migrations/001_initial.sql`

Both `openDb` and `openInMemoryDb` apply `INITIAL_SCHEMA_SQL` first, and `001_initial.sql` is exactly the pre-migration tables. Production then runs the migrator (in `main.ts`) which steps through 002→007 to fix it up. Tests run migrations in their helpers. So this works — but it's confusing: a fresh DB without the migrator runs is broken, and the `schema.ts` file is essentially historical.

**Fix:** Delete `INITIAL_SCHEMA_SQL` and have `openDb`/`openInMemoryDb` always run the migrator. The migrator already handles the "already at 001" case via the `schema_migrations` table. This removes one source of truth from the codebase.

## M-9 — `rateLimit` and `retention` keep wall-clock fallbacks despite injected clocks

**Files:** `src/services/rateLimit.ts:21` ; `src/services/retention.ts:40`

Both factories accept `now?: () => number` for tests but fall back to `Date.now()` if not passed. This mostly works because tests *do* pass a clock — but `npm test` reveals nothing if a future test forgets, and the fallback hides accidental wall-clock reads.

**Fix:** Make `now` required. Drop the fallback. Tests already inject clocks. Production wires `() => Date.now()` from `main.ts` once. This makes "the service uses wall-clock time" impossible to introduce by accident.

## M-10 — `dist/` is gitignored but exists locally; stale build can mask source bugs

**Files:** `.gitignore` ; `dist/`

Verified: `dist/` is in `.gitignore` (good), but a stale build from 2026-04-10 sits in the working directory. `npm start` runs `node dist/main.js`. If a developer edits `src/` and forgets to `npm run build`, they're testing yesterday's binary. This already nearly bit you with C-1/C-2 — the bug is in current `src/`, but tests use vitest's TS compilation so they exercise source, while `npm start` could behave differently.

**Fix:** Add a `prestart` hook in `package.json`: `"prestart": "npm run build"`. Or document loudly in README that `npm start` requires a fresh build. Or wire in `tsx`/`ts-node` for dev so source is the source of truth.

---

# Low / Nit

## L-1 — `conversationsRepo.insertChannel` hardcodes `recipient_id = ''` in SQL

**Files:** `src/db/repos/conversationsRepo.ts:28-29, 48-49`

The SQL has `'',` literally embedded for the `recipient_id` column. It works, but it's the only column in the file that isn't a `?` parameter, and it's easy to miss when reviewing. **Fix:** Replace with a `?` and pass `''` as a parameter — it's clearer that "no recipient for channel posts" is a deliberate sentinel and not a bug.

## L-2 — `audit_log.actor_id` and `target_id` lack indexes; future "audit by actor" queries will table-scan

**Files:** `src/db/migrations/003_audit_log.sql:16-17`

Only `ts` and `event_type` are indexed. If you ever add a "show me everything user X has done" admin query (which a privacy compliance audit will eventually require — see M-11 below), it'll table-scan a year of audit rows. **Fix:** When you add a future migration touching `audit_log`, throw in `CREATE INDEX idx_audit_log_actor_id ON audit_log(actor_id) WHERE actor_id IS NOT NULL`. Don't bother now.

## L-3 — Health endpoint comment doesn't mark it as bypassing signature verification

**Files:** `src/http/health.ts`

The route is intentionally exempt from Pumble signature verification (orchestrators have to be able to hit it), but no comment explains this. The next reviewer will wonder. **Fix:** Two-line comment at the top of the file: "These routes bypass signature verification by design."

## L-4 — Pumble SDK pinned to exact `1.1.1` with no audit cadence documented

**Files:** `package.json:23`

Pinning is correct, but there's no record of when the version was last vetted, no `npm audit` cadence, and no SECURITY.md mention of how to roll the pin. **Fix:** Add a one-line comment in `SECURITY.md` under "Maintenance": "Quarterly: `npm audit` and review pumble-sdk changelog. Last reviewed: 2026-04-15."

## L-5 — Logger field name inconsistency in retention purge log

**Files:** `src/services/retention.ts:70-79`

The purge-summary log uses snake_case keys (`audit_log`, `pending_replies`) while the rest of the codebase uses camelCase (`workspaceId`, `convId`). **Fix:** Rename to `auditLog`, `pendingReplies`, etc.

## L-6 — Coverage thresholds sit 2-3 points below measured baseline

**Files:** `vitest.config.ts:11-21`

Comment explicitly notes channel + thread error paths are uncovered. After fixing C-1/C-2/H-5, those paths will get test coverage and the thresholds should rise. **Fix:** After the high-priority fixes land, raise to `lines: 90, branches: 80, functions: 92, statements: 90`.

## L-7 — Right-to-erasure (GDPR/CCPA) has no documented mechanism

**Files:** `SECURITY.md` ; `src/`

If a Pumble user requests deletion of all their anonymous messages, there's no admin command or operator script to do it. The data lives at `conversations.sender_id = X OR conversations.recipient_id = X` (which can't even be queried efficiently — no index on those columns). **Fix:** Add a one-page section to `SECURITY.md` titled "Erasure requests" describing the operator's manual SQL recipe. Long-term: add a `/anon-erase-me` slash command that purges the requesting user's data.

## L-8 — `noUncheckedIndexedAccess` defeated by `as string` in `parseRecipient`

**Files:** `src/services/parseRecipient.ts:21-22`

`match[1] as string` and `match[2] as string` defeat the strict-index check. Regex semantics guarantee both groups exist when the overall pattern matches, so it's safe — but a `// regex guarantees both groups when pattern matches` comment would document the assumption. **Fix:** Add the comment, or restructure as `const [, userId = "", message = ""] = match;`.

---

# Notable strengths (do not regress)

- **Workspace scoping (almost) everywhere.** Migration 007 is well-executed: composite PKs, sensible empty-string sentinels for legacy data, recreated indexes on the rebuilt tables. The one exception (`conversations`, see C-3) is the only gap.
- **Rate limiting is atomic** via `repo.checkAndIncrement` — single SQL transaction, no check-then-act race.
- **`reportChannel.inflightCreates` cleanup is correct.** The `finally { inflightCreates.delete(workspaceId); }` runs on both success and failure paths. The audit agent flagged this as a "race condition" but verification shows the in-flight guard is fine for single-process SQLite.
- **Ack happens before any external call** in every slash command (`commands/anon.ts:16`). The "3-second ack" rule is structurally upheld; you cannot accidentally delay it by adding more business logic later.
- **`tsconfig.json` is strict-plus** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`). This rules out a lot of bug categories the audit otherwise would have found.
- **Pino redaction** is on in production logs; no raw message bodies leak.
- **Dockerfile drops to non-root** correctly via `tini` + `su-exec` after chowning the mount, exactly the pattern Railway needs.
- **Migrations are forward-only and numbered** with a `schema_migrations` row for each. The runner is wrapped in a transaction.

---

# Recommended fix order

Stage these as separate commits so each can be reviewed and reverted independently. Each line is an estimate of pure focus time, not calendar time.

| # | Finding | Why first | Effort |
|---|---|---|---|
| 1 | **C-1** `last_message` never persisted | Headline product bug; admin reports are broken | 1 h |
| 2 | **C-2** `thread_root_id` never persisted | Same root cause as C-1; channel→thread replies broken | 30 min on top of #1 |
| 3 | **H-3** Self-reports not blocked | Privacy regression, trivial fix | 20 min |
| 4 | **H-5** Pending reply not cleared on hard-validation errors | User-visible "stuck modal" bug | 30 min |
| 5 | **H-4** Retention catch + isRunning guard | Silent failure mode in prod, trivial fix | 20 min |
| 6 | **C-3** Workspace-scope `conversations.get` | Defense in depth; small change with big surface | 1 h |
| 7 | **H-1** Always pass `workspaceId` to `audit_log` | Forensic completeness | 30 min |
| 8 | **H-6** + **M-9** + **M-8** schema/clock/init cleanup | Single migration sweep | 1 h |
| 9 | **M-6** Modal audit-log gaps | Small, mechanical, completes the audit story | 30 min |
| 10 | **H-2** Decide token-storage policy (doc or encrypt) | Marketplace blocker if encrypt; docs only otherwise | 30 min – 4 h |
| 11 | Remaining mediums (M-1 through M-7, M-10) | Polish | 2-3 h together |
| 12 | Lows / nits | When bored | 1 h together |

After fixes #1–#9 land, re-run `npm test`, expect coverage to climb past the thresholds in `vitest.config.ts`, and bump the thresholds (L-6).

---

# Verification plan after fixes

1. **Unit/integration tests.** Add the missing tests called out per finding. After changes, `npm run type-check && npm run lint && npm test -- --coverage`. Coverage should rise meaningfully on `services/anonMessage.ts`, `commands/anon.ts`, `views/anonReplyModal.ts`.
2. **Manual smoke (dev tunnel).** `npm run dev` → in a real Pumble workspace, execute each of the four flows: DM, channel, thread root, channel→thread reply. After each, query the SQLite DB directly: `sqlite3 data/app.db "SELECT id, message_type, channel_id, thread_root_id, last_message FROM conversations ORDER BY created_at DESC LIMIT 4"`. Assert every row has `last_message` populated and channel/thread rows have `thread_root_id` set.
3. **Report flow end-to-end.** Click "Report" on each of the four messages. Verify the admin report channel shows the actual message text, not "(message not available)".
4. **Self-report.** As the original sender, click "Report" on your own message. Verify nothing is posted to the report channel and an audit row with `outcome = "self-report"` exists.
5. **Workspace isolation regression test.** With two workspaces installed simultaneously, generate a convId in `ws-1`, then attempt to look it up via the modified `conversations.get("ws-2", id)` — must return `undefined`. (This is a vitest test, not a manual step.)
6. **Retention robustness.** Inject a throwing repo into `startRetentionScheduler`, assert the scheduler logs but does not crash, and the next tick still runs. (vitest)
7. **Type-check + lint must remain clean** after every commit.

---

# Prompt for next session

> I just received a comprehensive audit of the `anon` Pumble addon at `/Users/15x/Downloads/WORKING/addons-me/anon`. The full findings are in `addons-me/anon/AUDIT.md` (originally written to `/Users/15x/.claude/plans/sparkling-marinating-flask.md` and moved into the repo).
>
> Please open `AUDIT.md` and start working through the fixes in the **Recommended fix order** table. Do C-1 and C-2 first — they share a root cause (UPDATE-before-INSERT in `services/anonMessage.ts`) and break the report flow end-to-end. Move the `conversations.insert/insertChannel` ahead of the Pumble API call, eliminate `updateLastMessage` from the service entirely, and have `sendToChannel` return the Pumble `msg.id` so the caller can `updateThreadRootId` against an existing row.
>
> Before writing any code, write the failing test cases first (TDD): add tests that assert `conversations.get(convId).last_message` and `.thread_root_id` are populated after each of the three `anonMessage.*` flows. Run `npm test`, confirm they fail, then make them pass.
>
> Each fix should be a separate commit referencing the finding ID (C-1, C-2, H-3, etc.). After the critical and high-severity items are merged, re-run `npm test -- --coverage` and bump the thresholds in `vitest.config.ts` per finding L-6.
>
> Do not start the medium or low items until all critical/high are merged. If anything in the audit looks wrong on closer inspection, push back on it explicitly rather than working around it.
