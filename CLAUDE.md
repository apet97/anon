# Anon — Contributor Guide

Pumble anonymous messaging bot. TypeScript + Node.js + SQLite.

See [`README.md`](./README.md) for the user-facing pitch, [`docs/SPEC.md`](./docs/SPEC.md) for architecture, and [`SECURITY.md`](./SECURITY.md) for secrets policy.

## Commands

```bash
npm install
npm run type-check    # strict tsc (src + tests) — must be clean
npm test              # vitest run — must be green
npm run test:coverage # vitest + v8 coverage — must meet thresholds
npm run lint          # eslint src/
npm run build         # tsc → dist/ + copy migrations
npm run dev           # pumble-cli dev server (local tunnel + manifest sync)
```

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ (LTS) |
| Language | TypeScript (strict mode) |
| Framework | Pumble SDK 1.1.1 (`pumble-sdk`) |
| Database | SQLite via `better-sqlite3` (synchronous, WAL mode) |
| Testing | Vitest + v8 coverage |
| Logging | Pino (structured JSON, PII redacted) |
| Container | Alpine + tini + su-exec (non-root) |
| Hosting | Railway (with persistent volume at `/app/data`) |
| CI | GitHub Actions (Node 20+22 matrix) |

## Architecture at a glance

```
ctx.payload → command/interaction/view handler → service → repo → SQLite
                         ↓
                      AppDeps (dependency bag injected into every handler)
```

Every handler factory (`makeXxxCommand`, `makeXxxHandler`) takes `AppDeps` and returns a handler function. No global state. Services own business logic; repos own SQL.

## `/anon` is context-aware

One handler, three paths based on `ctx.payload`:

1. `<<@USER_ID>>` at the start of `text` → anonymous DM (`anonMessage.send`)
2. `ctx.payload.threadRootId` present → anonymous thread reply (`anonMessage.replyInThread`)
3. otherwise → anonymous channel post (`anonMessage.sendToChannel`)

Detection lives in `src/commands/anon.ts`. DM takes priority over thread context — a `/anon @user msg` inside a thread is still a DM, not a thread reply.

## Pumble SDK rules (non-negotiable)

- `ctx.ack()` within 3 seconds on slash commands and block interactions.
- **Never** `ctx.ack()` when opening, pushing, or updating a modal — the modal *is* the response.
- `viewAction.onSubmit` and `viewAction.onClose` must `ctx.ack()`.
- Slash-command user mentions are formatted `<<@USER_ID>>`.
- `line_mode: "multiline"` on `plain_text_input` — NOT `multiline: true`.
- `ctx.getUserClient()` and `ctx.getBotClient()` can return `undefined` — always null-check.
- `ctx.payload.view.state.values` is keyed by `blockId` then inner element `onAction`.
- The Pumble SDK reads `PUMBLE_ADDON_PORT` (not `PORT`), default 5000. We thread `deps.config.port` into the `App.port` field so Railway's `PORT` env works.
- `App.slashCommands[].usageHint` is for **arguments only**, not the full command — Pumble renders it as `<command> <hint>` concatenated.

## Security rules

- Never commit secrets: `.env`, `tokens.json`, `.pumbleapprc`, `.pumble-app-manifest.json`, `*.db*`, `data/`.
- Never log raw message bodies — only IDs, event type, and outcome.
- Sender identity is hidden from recipients; revealed to admins only via the private reports channel on explicit report.
- All sensitive flows write to `audit_log` with `outcome` metadata.
- Signature verification is SDK-native (HMAC-SHA256 of `${timestamp}:${rawBody}`) — don't reimplement it.

## Persistence rules

- SQLite only (`better-sqlite3`). No Redis, no durable in-memory state.
- Migrations are forward-only; never edit existing `.sql` files. New migrations get new numbers.
- Rate-limit check-and-increment is a single atomic SQLite transaction (`repo.checkAndIncrement`).
- `openDb()` sets WAL, `busy_timeout=5000`, `synchronous=NORMAL`, 10 MB WAL cap.
- **Every table is workspace-scoped.** All repo methods take `workspaceId` as their first parameter. Handlers extract it from `ctx.payload.workspaceId`. The `config` table PK is `(workspace_id, key)`, not just `key`.
- The `conversations` table has `workspace_id`, `message_type` (`'dm' | 'channel' | 'thread'`), `channel_id`, and `thread_root_id` columns. The `thread_root_id` is captured from Pumble's response to `postMessageToChannel()` so replies can call `client.v1.messages.reply()` with a real message ID.
- The `reportChannel` service uses a `Map<workspaceId, Promise>` in-flight guard so concurrent first-reports in the same workspace share one channel-creation promise, while different workspaces create independently.

## Database tables (7 migrations)

| Table | PK | Workspace-scoped | Purpose |
|-------|-----|:-:|---------|
| `conversations` | `id` (UUID) | yes | Sender/recipient identity, message type, thread context |
| `blocked_users` | `(workspace_id, user_id)` | yes | Opt-out list for DMs |
| `rate_limits` | `(workspace_id, user_id)` | yes | Global per-sender rate counter |
| `target_limits` | `(workspace_id, sender_id, target_id)` | yes | Per-pair rate counter |
| `config` | `(workspace_id, key)` | yes | Report channel ID, future settings |
| `pending_replies` | `(workspace_id, user_id)` | yes | Modal state (survives restart) |
| `audit_log` | `id` (auto) | yes | Every sensitive event with outcome |
| `tokens` | `(workspace_id, workspace_user_id, token_kind)` | yes | Bot + user OAuth tokens |

Retention scheduler purges `conversations` and `audit_log` at 90 days, `pending_replies` at 24 hours, rate/target limits at their window expiry.

## Reply flow routing

`src/views/anonReplyModal.ts` looks up `conv.message_type`:

- `dm` → flip direction and DM back via `anonMessage.send`
- `channel` or `thread` → `anonMessage.replyInThread(conv.thread_root_id, conv.channel_id, ...)`

Channel/thread replies skip the self-reply and block-check guards (no specific recipient to check).

## Testing patterns

- In-memory SQLite via `makeTestDeps()` or `makeTestDb()` — both run all 7 migrations.
- All repo/service calls must pass a workspace ID (`"ws-1"` by convention).
- Inject clocks via `now?: () => number` on service factories.
- `tests/helpers/ctx.ts` — fake slash-command, block-interaction, and view-action contexts.
- `tests/helpers/pumbleClient.ts` — `FakePumbleClient` captures `posts`, `channelPosts`, `threadReplies` in separate arrays.
- 117 tests across 21 files. Coverage thresholds enforced in CI.

## Lifecycle events

| Event | Handler | Cleanup |
|-------|---------|---------|
| `APP_UNINSTALLED` | `src/events/appUninstalled.ts` | Tokens, pending replies, blocked users, rate limits, target limits, config |
| `APP_UNAUTHORIZED` | `src/events/appUnauthorized.ts` | User token + user pending replies only |

Conversations and audit_log are preserved on uninstall for admin review.

## Production quirks learned the hard way

- **Railway bans `VOLUME` directives in Dockerfiles.** Use Railway's volume API instead. Our Dockerfile has no `VOLUME`; `/app/data` is the mount point only.
- **Mounted volumes come up owned by root.** The Dockerfile starts as root, `chown -R node:node /app/data`, then `exec su-exec node node dist/main.js` to drop privileges.
- **`manifest.json` must be COPY'd into the runtime image.** The SDK reads it at startup from CWD.
- **OAuth consent URL for reinstalls:** scope names need `bot:` prefix when passed via the `scopes` query param. E.g. `bot:messages:write`, not `messages:write`.
- **`pumble-cli pre-publish` is interactive.** It prompts `Do you want to apply these updates? (y/N)`. Pipe `y` via stdin, don't pipe output through `tail`/`grep` (the buffer swallows the prompt and deadlocks).

## Marketplace status

- Multi-workspace ready (migration 007, all tables scoped)
- 117/117 tests, 0 vulnerabilities, privacy policy published
- Deployed on Railway: `https://anon-production-c04a.up.railway.app`
- Next step: `pumble-cli pre-publish` → CAKE.com developer portal submission
