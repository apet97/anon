# Anon (Pumble Anonymous Messaging Bot)

Standalone repo for the Pumble anonymous-messaging bot. Product and technical
authority:

- [docs/PRD.md](./docs/PRD.md)
- [docs/SPEC.md](./docs/SPEC.md)
- [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)
- [SECURITY.md](./SECURITY.md) (rotation checklist)

## Code layout (post-refactor)

```
src/
├── main.ts                    # bootstrap only
├── app.ts                     # App assembly; exported for tests
├── config.ts                  # env validation, fail-fast
├── logger.ts                  # pino + redaction
├── commands/                  # /anon, /anon-block, /anon-unblock
├── interactions/              # reply_anon, report_anon
├── views/                     # anon_reply_modal submit/close
├── events/                    # APP_UNAUTHORIZED, APP_UNINSTALLED
├── services/                  # anonMessage, reportChannel, rateLimit, pendingReplies
├── db/
│   ├── connection.ts
│   ├── migrations/            # 001_initial.sql ... 004_tokens.sql + migrator.ts
│   └── repos/                 # one per table
├── tokens/                    # SqliteCredentialsStore (7-method contract)
└── http/
    └── health.ts              # GET /health
```

## Non-negotiable Pumble SDK rules

- Slash commands and shortcuts must `ctx.ack()` within 3 seconds.
- **Never** `ctx.ack()` when opening, pushing, or updating modals.
- `viewAction.onSubmit` must `ctx.ack()`.
- `viewAction.onClose` must `ctx.ack()`.
- Slash-command mentions are formatted `<<@USER_ID>>`.
- Use `line_mode: "multiline"` on `plain_text_input`, **not** the silently-ignored `multiline: true`.
- `ctx.payload.view.state.values` is keyed by `blockId`, then inner element `onAction`.
- `CredentialsStore` is a 7-method contract (see `docs/SPEC.md`).
- Production trigger URL updates go through `npx pumble-cli pre-publish --host https://...`.
- Production must use explicit app secrets from env vars (never the CLI-only `.pumbleapprc`).

## Security

- Never commit: `tokens.json`, `.pumbleapprc`, `.pumble-app-manifest.json`, `.env`, `conversations.db*`, `data/`, `reference/`.
- Never log raw message bodies. Only IDs + event type + outcome.
- Sender identity is hidden from the recipient. It is exposed to admins only
  through the `#abot-reports` channel when the report button is pressed.
- Rotation checklist: `SECURITY.md`.

## Persistence

- v1 backend is SQLite via `better-sqlite3`. Do not introduce Redis.
- Migrations are forward-only, tracked in `schema_migrations`, applied on boot.
- `pending_replies` is SQLite-backed — **no in-memory Map**. The modal flow
  must survive process restart.

## Testing

- `npm run type-check` — strict TS clean.
- `npm test` — vitest suite (unit + integration + restart-survival).
- `npm run build` — emits `dist/`.
- `docker build -t anon:test .` — smoke test.

## Branch + commits

- Branch: `refactor/enterprise` until merged to `main`.
- Small, reviewable commits grouped by concern. One phase ≠ one commit.
