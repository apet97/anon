# AGENTS.md

Instructions for automated coding agents. Human-readable guide: [`CLAUDE.md`](./CLAUDE.md).

## Commands

```bash
npm run type-check    # strict tsc — must be clean
npm test              # vitest run — must be green
npm run test:coverage # vitest + v8 coverage — must meet thresholds
npm run lint          # eslint src/ — must be clean
npm run build         # tsc + copy migrations
```

## `/anon` routing

Single `/anon` command routes three ways based on `ctx.payload`:

1. `<<@USER_ID>>` prefix → DM (`anonMessage.send`)
2. `threadRootId` present → thread reply (`anonMessage.replyInThread`)
3. otherwise → channel post (`anonMessage.sendToChannel`)

DM priority beats thread context. All three paths share the same Reply + Report buttons and audit-log discipline.

## Hard rules

- `ctx.ack()` within 3s on slash commands and block interactions; **never** ack a modal.
- `viewAction.onSubmit` and `viewAction.onClose` must `ctx.ack()`.
- Slash-command mentions: `<<@USER_ID>>` format.
- `line_mode: "multiline"` on textareas — `multiline: true` is silently ignored.
- `ctx.getBotClient()` and `ctx.getUserClient()` can return `undefined` — null-check.
- SQLite is the only persistence layer; no in-memory state for anything durable.
- Migrations are forward-only; never edit existing `.sql` files.
- Rate-limit check+increment must go through `repo.checkAndIncrement()` (atomic).
- Never log message bodies; never commit `.env`, `tokens.json`, `.pumbleapprc`, or `*.db*`.
- `App.port = deps.config.port` in `createApp` — pumble-sdk doesn't read `PORT`, it reads `PUMBLE_ADDON_PORT` (default 5000).

## Testing approach

- In-memory SQLite via `makeTestDeps()` (runs all migrations) or `makeTestDb()` (runs all migrations too, post-2026-04-12 update).
- Inject clocks via `now?: () => number` on service factories.
- Use the `tests/helpers/` ctx builders for slash-command, block-interaction, and view-action tests.
- The fake `FakePumbleClient` captures `posts`, `channelPosts`, `threadReplies` separately — use the right array for the flow under test.
