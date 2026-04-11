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
- The `conversations` table has `message_type` (`'dm' | 'channel' | 'thread'`), `channel_id`, and `thread_root_id` columns for channel/thread replies. The `thread_root_id` is captured from Pumble's response to `postMessageToChannel()` so replies can call `client.v1.messages.reply()` with a real message ID.

## Reply flow routing

`src/views/anonReplyModal.ts` looks up `conv.message_type`:

- `dm` → flip direction and DM back via `anonMessage.send`
- `channel` or `thread` → `anonMessage.replyInThread(conv.thread_root_id, conv.channel_id, ...)`

Channel/thread replies skip the self-reply and block-check guards (no specific recipient to check).

## Production quirks learned the hard way

- **Railway bans `VOLUME` directives in Dockerfiles.** Use Railway's volume API instead. Our Dockerfile has no `VOLUME`; `/app/data` is the mount point only.
- **Mounted volumes come up owned by root.** The Dockerfile starts as root, `chown -R node:node /app/data`, then `exec su-exec node node dist/main.js` to drop privileges.
- **`manifest.json` must be COPY'd into the runtime image.** The SDK reads it at startup from CWD.
- **OAuth consent URL for reinstalls:** scope names need `bot:` prefix when passed via the `scopes` query param. E.g. `bot:messages:write`, not `messages:write`.
- **`pumble-cli pre-publish` is interactive.** It prompts `Do you want to apply these updates? (y/N)`. Pipe `y` via stdin, don't pipe output through `tail`/`grep` (the buffer swallows the prompt and deadlocks).
