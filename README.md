# Anon — Anonymous Messaging for Pumble

Send anonymous messages and have two-way anonymous conversations in Pumble,
with an opt-out system and an abuse-report flow that reveals the sender's
identity to workspace admins in a private reports channel.

Product + technical authority:

- [docs/PRD.md](./docs/PRD.md) — product requirements and abuse model
- [docs/SPEC.md](./docs/SPEC.md) — architecture, tables, trigger matrix, PII rules
- [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) — phase ordering
- [SECURITY.md](./SECURITY.md) — secrets policy and rotation checklist

## Features

- `/anon @user message` — one-shot anonymous send
- Reply button + modal for anonymous back-and-forth
- `/anon-block` / `/anon-unblock` — opt-out
- Report button reveals sender identity to admins in the auto-created private
  `#abot-reports` channel
- Global rate limit: 5 messages / sender / minute
- Per-target rate limit: 2 messages / (sender, recipient) / hour
- 2000-character message cap
- Durable state: conversations, rate limits, reply modals, audit log, and
  tokens all persist in SQLite. The reply modal flow survives a restart.
- Structured pino logging with strict redaction; raw message bodies are
  never written to logs
- `GET /health` endpoint with SQLite reachability check
- Docker and GitHub Actions CI included

## Prerequisites

- Node.js `>=20.11`
- A Pumble workspace with a registered app — see
  https://pumble.com/app/marketplace
- The app's ID, API key, OAuth client secret, and signing secret

## Local development

```bash
cp .env.example .env
# Fill in the PUMBLE_APP_* values from your marketplace app's Credentials page.

npm install
npm run type-check
npm test
npm run dev        # runs pumble-cli in dev mode
```

`npm run dev` spins up the Pumble CLI, which talks to the local process on
the port printed in the output.

The SQLite database defaults to `./data/anon.db`; the `data/` directory is
created on first run and is gitignored.

## Production

```bash
# 1. Publish trigger URLs
npx pumble-cli pre-publish --host https://<your-prod-host>

# 2. Build
npm ci
npm run build      # tsc + copy migrations to dist/

# 3. Run
node dist/main.js
```

Configuration is read **only** from environment variables (`.pumbleapprc` is
not consulted in production). See `.env.example` for the full list and
`SECURITY.md` for the rotation checklist.

### Docker

```bash
docker build -t anon:latest .
docker run --rm \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -p 3000:3000 \
  anon:latest
curl -sSf http://localhost:3000/health | jq
```

The image is a two-stage node:24.14-alpine build that runs as the `node`
user under `tini`. Mount a host directory at `/app/data` to persist SQLite
across container restarts.

### Health endpoint

```bash
GET /health
{
  "status": "ok",
  "db": "ok",
  "version": "0.1.0",
  "uptime": 42
}
```

Returns `503` if the SQLite `SELECT 1` probe fails so orchestrators can
restart the pod.

## Scripts

| script | what it does |
|---|---|
| `npm run type-check` | strict tsc of src/ and tests/ |
| `npm test` | vitest run (67 tests) |
| `npm run test:watch` | vitest in watch mode |
| `npm run test:coverage` | vitest with v8 coverage |
| `npm run build` | tsc + copy .sql migrations into dist/ |
| `npm start` | node dist/main.js |
| `npm run dev` | pumble-cli dev server |

## Scopes

- `messages:read`, `messages:write`
- `channels:read`, `channels:list`, `channels:write`
- `users:list`

## Repository layout

```
src/
├── main.ts                       # runtime bootstrap
├── app.ts                        # createApp(deps) — pure, testable
├── config.ts                     # env validation, fail-fast
├── logger.ts                     # pino + redaction
├── deps.ts                       # AppDeps dependency bag
├── commands/                     # /anon, /anon-block, /anon-unblock
├── interactions/                 # reply_anon, report_anon
├── views/                        # anon_reply_modal submit + close
├── events/                       # APP_UNAUTHORIZED, APP_UNINSTALLED
├── services/                     # rateLimit, anonMessage, reportChannel, pendingReplies
├── db/
│   ├── connection.ts
│   ├── schema.ts
│   ├── migrations/               # 001..004 + migrator.ts
│   └── repos/                    # one per table
├── tokens/                       # SqliteCredentialsStore (7-method contract)
└── http/health.ts

tests/                             # vitest suite — 67 tests
docs/                              # PRD, SPEC, IMPLEMENTATION_PLAN
scripts/copy-migrations.mjs        # build-time asset copy
Dockerfile                         # two-stage node:24.14-alpine
.github/workflows/ci.yml           # node 20+22 matrix + docker smoke
```
