<p align="center">
  <img src="./icon.svg" alt="Anon" width="140" height="140" />
</p>

<h1 align="center">Anon</h1>

<p align="center">
  <strong>Anonymous messaging for Pumble workspaces.</strong><br/>
  DMs, channel posts, and thread replies — with an abuse-report trail that reveals identities to admins on demand.
</p>

<p align="center">
  <a href="https://github.com/apet97/anon/actions"><img alt="CI" src="https://github.com/apet97/anon/actions/workflows/ci.yml/badge.svg"/></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520.11-brightgreen"/>
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-blue"/>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-lightgrey"/>
</p>

---

## What it does

Anon is a context-aware Pumble bot. One command — `/anon` — does three different things depending on where you use it:

| You type | Where | Result |
|---|---|---|
| `/anon @alex what do you think?` | anywhere | Anonymous DM to @alex |
| `/anon I think option B is better` | in a channel | Anonymous post in that channel |
| `/anon great point, +1` | inside a thread | Anonymous thread reply |

Every anonymous message carries two buttons:

- **Reply Anonymously** — opens a modal; the reply routes back through the same channel (DM, channel, or thread) without revealing who you are
- **Report** — posts the message to an auto-created private `#abot-reports` channel with the original sender's identity revealed to every workspace OWNER and ADMIN

No one sees the sender unless someone clicks Report.

---

## Features

- **Context-aware `/anon`** — detects DM vs channel vs thread from the slash-command payload, no sub-commands
- **Two-way anonymous replies** — conversations flow back and forth without either side learning the other's identity
- **Admin accountability** — every message is auditable, every report reveals the sender to admins in an auto-created private channel
- **Opt-out** — `/anon-block` and `/anon-unblock` let any user stop receiving anonymous DMs at any time
- **Rate limiting** — 20 messages/minute per sender globally, 10 messages/hour per (sender, channel-or-recipient) pair
- **Abuse-safe defaults** — 2000-character cap, self-send blocked, blocked-user list enforced, every action written to an audit log
- **Durable state** — SQLite-backed with WAL, atomic rate-limit transactions, a forward-only migration runner, and a reply modal flow that **survives a process restart**
- **Signed webhooks** — every inbound request verified via HMAC-SHA256 against Pumble's signing secret (SDK default)
- **Observability** — `pino` structured logging with strict PII redaction, `/health` liveness + readiness probes, and a 90-day retention scheduler that purges audit logs, conversations, and pending replies on a 6-hour cadence
- **Container image** — two-stage `node:24.14-alpine` Docker image running as non-root under `tini`, persistent volume mount at `/app/data`, CI matrix on Node 20 + 22 with coverage gating, Docker build smoke test

---

## Quick start

### Local development

```bash
git clone https://github.com/apet97/anon.git
cd anon
npm install

cp .env.example .env
# Fill PUMBLE_APP_ID, PUMBLE_APP_KEY, PUMBLE_APP_CLIENT_SECRET, PUMBLE_APP_SIGNING_SECRET
# from your Pumble marketplace app's Credentials page.

npm run dev
```

`pumble-cli` will spawn a local HTTP tunnel, sync the manifest to your Pumble workspace, and start the bot. Open any channel and type `/anon` to try it.

### Production deploy (Railway, Fly, VPS, K8s)

```bash
# 1. Tell Pumble where to send webhook traffic.
npx pumble-cli pre-publish --host https://<your-prod-host>

# 2. Build the compiled app.
npm ci
npm run build

# 3. Start it with env vars set (.env NOT read in production — prod reads process.env only).
PUMBLE_APP_ID=... \
PUMBLE_APP_KEY=... \
PUMBLE_APP_CLIENT_SECRET=... \
PUMBLE_APP_SIGNING_SECRET=... \
DATABASE_PATH=/app/data/anon.db \
node dist/main.js
```

See [`SECURITY.md`](./SECURITY.md) for secret rotation and [`docs/SPEC.md`](./docs/SPEC.md) §3 for the full runtime topology.

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

Two-stage Alpine build that runs as the `node` user under `tini`. **Mount a host directory at `/app/data` or the SQLite database is wiped on every container restart.**

---

## Commands

| Command | What it does |
|---|---|
| `/anon @user msg` | Send an anonymous DM to @user |
| `/anon msg` (in a channel) | Post an anonymous message in the current channel |
| `/anon msg` (inside a thread) | Post an anonymous thread reply |
| `/anon-block` | Stop receiving anonymous DMs |
| `/anon-unblock` | Resume receiving anonymous DMs |

Every anonymous message comes with **Reply Anonymously** and **Report** buttons. Replies thread back through the same channel the original used. Reports reveal the sender to workspace admins in `#abot-reports` (auto-created on first report).

---

## How anonymity works (and where it stops)

Anon is **pseudonymous with admin accountability**, not true anonymity. Read the full threat model in [`SECURITY.md`](./SECURITY.md) and [`docs/PRD.md`](./docs/PRD.md) §4. Summary:

- **Recipients never learn who sent a message.** The bot posts on behalf of the sender; nothing in the message blocks, text, or metadata visible to recipients reveals their identity.
- **Workspace admins can learn on demand.** When any recipient clicks **Report**, the sender's workspace user ID is posted to the private `#abot-reports` channel. Every workspace OWNER and ADMIN is automatically invited to that channel on its first creation.
- **Bot operators can learn from the database.** The SQLite `conversations` table records `sender_id` for every message so the report flow works. Anyone with read access to the production database can therefore de-anonymize messages. Treat that database accordingly — see [`SECURITY.md`](./SECURITY.md).
- **Multi-workspace safe.** Every table is scoped by `workspace_id`. Installing Anon on multiple workspaces creates fully isolated data — block lists, rate limits, report channels, and conversations never cross workspace boundaries.
- **Logs never contain message bodies.** The pino logger redacts raw text; only IDs, event types, and outcomes are logged.

Anon is safe for candid peer feedback inside a company. It is **not** safe as a whistleblower or source-protection tool against the workspace's own administrators.

---

## Architecture

```
src/
├── main.ts                   Runtime bootstrap, crash handlers, graceful shutdown
├── app.ts                    createApp(deps) — pure, returns the Pumble App config
├── config.ts                 Fail-fast env validation (PUMBLE_APP_* + runtime)
├── logger.ts                 pino + strict PII redaction
├── shutdown.ts               SIGTERM/SIGINT handlers, retention-scheduler cleanup
├── deps.ts                   AppDeps dependency bag type
├── commands/                 /anon, /anon-block, /anon-unblock
├── interactions/             reply_anon, report_anon button handlers
├── views/                    anon_reply_modal submit + close
├── events/                   APP_UNAUTHORIZED, APP_UNINSTALLED lifecycle
├── services/
│   ├── anonMessage.ts        DM, channel, thread — all three posting paths
│   ├── rateLimit.ts          Global + per-target atomic check-and-increment
│   ├── reportChannel.ts      Auto-create #abot-reports, in-flight dedup guard
│   ├── pendingReplies.ts     SQLite-backed modal state, survives restart
│   ├── retention.ts          6-hour scheduler purges 90d/24h time-bounded tables
│   └── parseRecipient.ts     <<@USER_ID>> mention parsing
├── db/
│   ├── connection.ts         WAL, busy_timeout, synchronous=NORMAL, 10MB WAL cap
│   ├── schema.ts             Baseline CREATE IF NOT EXISTS
│   ├── migrations/           Forward-only .sql runner tracked in schema_migrations
│   └── repos/                One file per table — atomic rate-limit transactions
├── tokens/                   SqliteCredentialsStore (7-method SDK contract)
└── http/health.ts            GET /health, GET /ready — SQLite SELECT 1 probe

tests/                        vitest suite — mirrors src/ layout
docs/                         PRD, SPEC, privacy policy
scripts/copy-migrations.mjs   Build-time asset copy (.sql → dist/)
Dockerfile                    Two-stage node:24.14-alpine + tini + su-exec
.github/workflows/ci.yml      Matrix: Node 20 + 22 → type-check → coverage → build → docker smoke
```

See [`docs/SPEC.md`](./docs/SPEC.md) for the full table schemas, trigger matrix, PII rules, and persistence contract.

---

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `pumble-cli` dev server with hot manifest sync |
| `npm run type-check` | Strict `tsc` over `src/` and `tests/` (both tsconfigs) |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` in watch mode |
| `npm run test:coverage` | `vitest` with v8 coverage + threshold gate |
| `npm run lint` | `eslint src/` |
| `npm run build` | `tsc` → `dist/` + copy SQL migrations |
| `npm start` | `node dist/main.js` (production-style) |

CI runs every script on every push: type-check → coverage-gated tests → build → migration artifact check → docker build.

---

## Configuration

Anon reads configuration exclusively from **environment variables**. `.env` is only loaded in local dev via `pumble-cli`; production containers must set vars through their platform (Railway Variables, Fly secrets, K8s Secret, etc.).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PUMBLE_APP_ID` | yes | — | 24-char app identifier |
| `PUMBLE_APP_KEY` | yes | — | `xpat-…` server API key |
| `PUMBLE_APP_CLIENT_SECRET` | yes | — | `xpcls-…` OAuth client secret |
| `PUMBLE_APP_SIGNING_SECRET` | yes | — | `xpss-…` webhook HMAC secret |
| `DATABASE_PATH` | no | `./data/anon.db` | SQLite file location |
| `LOG_LEVEL` | no | `info` | pino level: `fatal`…`trace` |
| `PORT` | no | `3000` | HTTP listen port |
| `NODE_ENV` | no | `development` | `development`, `test`, `production` |

Full template in [`.env.example`](./.env.example). Rotation checklist in [`SECURITY.md`](./SECURITY.md).

---

## Pumble scopes requested

- `messages:write` — post anonymous messages
- `channels:read`, `channels:list` — look up DM channels, list workspace channels
- `channels:write` — create the private `#abot-reports` channel
- `users:list` — enumerate OWNER+ADMIN members for the reports channel invite

No `messages:read` — Anon never reads workspace messages. No `reaction:read` — reactions are not tracked.

---

## Documentation

- [**`docs/PRD.md`**](./docs/PRD.md) — product requirements and abuse model
- [**`docs/SPEC.md`**](./docs/SPEC.md) — architecture, tables, trigger matrix, PII rules
- [**`docs/PRIVACY.md`**](./docs/PRIVACY.md) — privacy policy (published at [apet97.github.io/anon/PRIVACY](https://apet97.github.io/anon/PRIVACY))
- [**`SECURITY.md`**](./SECURITY.md) — secrets policy, threat model, rotation checklist

---

## License

[MIT](./LICENSE)
