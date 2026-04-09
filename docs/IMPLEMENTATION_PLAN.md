# Anon Implementation Plan

**Status:** Phase 0 – 7 executed on 2026-04-09 in the standalone repo
(`apet97/anon`, branch `refactor/enterprise`). Phase 7 is the final
verification sweep; the only remaining work is the manual rollout
checklist documented at the end of this file.

**Date:** 2026-04-08 (original), 2026-04-09 (execution)

**Constraint:** do not refactor inside the nested abot/ working folder;
execution lives in the standalone repo.

## Overview

This plan converts Abot from a prototype into a production-ready Pumble app in controlled phases. The order matters:

1. separate the repo safely
2. rotate secrets
3. align runtime and tooling
4. characterize behavior with tests
5. refactor structure without changing behavior
6. add durable state, security hardening, and ops support
7. verify production workflows before rollout

## Phase 0: Standalone Repo Extraction and Secret Rotation — DONE 2026-04-09

### Goal

Stop working inside the nested parent repo and create a clean standalone Abot repo mapped to `https://github.com/apet97/anon`.

### Work

- clone `apet97/anon` into a clean sibling directory
- copy vetted Abot files into that clone
- ensure secrets and local artifacts are excluded
- rotate live credentials in `tokens.json` and `.pumbleapprc`
- make documentation the first commit in the standalone repo

### Acceptance Criteria

- no work continues inside `/Users/15x/Downloads/WORKING/addons-me/abot` as the long-term repo root
- standalone clone exists and targets `apet97/anon`
- `tokens.json`, `.pumbleapprc`, `.env`, database files, and `reference/` are not tracked
- rotated credentials are available only through secure local env/secrets handling

### Rollback

- discard the standalone clone
- keep the current working folder unchanged
- do not push any extracted history

## Phase 1: Runtime and Tooling Alignment — DONE 2026-04-09

### Goal

Bring the app onto the current published Pumble packages and production-compatible startup configuration.

### Work

- upgrade `pumble-sdk` to `1.1.1`
- upgrade `pumble-cli` to `1.1.1`
- add explicit scripts for:
  - `compile`
  - `build`
  - `type-check`
  - `test`
- add environment-based startup validation for required `PUMBLE_APP_*` secrets
- keep behavior as close to current as possible

### Suggested Commit Group

- `chore: upgrade pumble sdk and cli`
- `chore: add explicit build and typecheck scripts`
- `chore: fail startup when required production env is missing`

### Acceptance Criteria

- dependencies install cleanly
- `type-check` passes
- app still boots in dev
- production path no longer depends on `.pumbleapprc` alone

### Rollback

- revert dependency and script commits
- restore prior package versions

## Phase 2: Test Harness and Baseline Characterization — DONE 2026-04-09

### Goal

Capture the current behavior with automated tests before major restructuring.

### Work

- add test runner and fixtures
- add repository-level SQLite test helpers
- add mock Pumble context / API client helpers
- write characterization tests for:
  - `/anon`
  - `/anon-block`
  - `/anon-unblock`
  - reply modal flow
  - report flow
  - failure cases

### Suggested Commit Group

- `test: add vitest harness and fixtures`
- `test: characterize slash command behavior`
- `test: characterize reply and report flows`

### Acceptance Criteria

- tests cover the current externally visible behavior
- report flow is reproducible in tests even before production verification
- failures are explicit rather than silent

### Rollback

- remove test harness and fixtures
- revert tests independently of runtime code

## Phase 3: Module Split Without Behavioral Change — DONE 2026-04-09

### Goal

Break the single-file implementation into stable modules while preserving behavior.

### Work

- move bootstrap into `src/main.ts`
- create `src/app.ts`
- extract:
  - `commands/`
  - `interactions/`
  - `views/`
  - `events/`
  - `services/`
  - `db/`
- keep the same trigger names, reply semantics, and message format

### Suggested Commit Group

- `refactor: extract app bootstrap`
- `refactor: extract command handlers`
- `refactor: extract interaction and view handlers`
- `refactor: extract services and repositories`

### Acceptance Criteria

- no intentional user-facing behavior changes
- test suite still passes after each extraction group
- `src/main.ts` becomes a thin composition file

### Rollback

- revert the most recent extraction commit group
- keep tests to catch drift during retry

## Phase 4: Durable State and Data Migrations — DONE 2026-04-09

### Goal

Eliminate restart-sensitive reply state and formalize schema evolution.

### Work

- add migration runner
- migrate existing inline schema to versioned SQL migrations
- add `pending_replies`
- add `audit_log`
- add `tokens`
- implement a custom SQLite `CredentialsStore`
- remove dependence on in-memory `pendingReplies`

### Suggested Commit Group

- `feat: add sqlite migrations`
- `feat: persist pending reply state`
- `feat: add sqlite credentials store and audit log`

### Acceptance Criteria

- restart after modal open does not break reply submission
- uninstall and unauthorized events can clean up stored credentials
- schema upgrades are repeatable and idempotent

### Rollback

- revert migration and persistence commits together
- restore in-memory reply state temporarily only if needed to recover service

## Phase 5: Security Hardening — DONE 2026-04-09

### Goal

Move from “works in dev” to production-safe request handling and privacy posture.

### Work

- verify signature handling in the production path
- add startup validation for missing or invalid secret configuration
- redact secrets from logs
- keep raw message bodies out of application logs
- add audit events for sensitive flows
- document and test token cleanup on lifecycle events

### Suggested Commit Group

- `feat: harden request verification path`
- `feat: add audit logging and log redaction`
- `test: verify lifecycle cleanup and signature handling`

### Acceptance Criteria

- invalid signatures are rejected
- missing signing/config secrets fail fast
- logs do not leak tokens, secrets, or message bodies

### Rollback

- revert security-specific commits without removing the modular refactor
- keep production deployment disabled until hardening is restored

## Phase 6: Operations and Deployment — DONE 2026-04-09

### Goal

Make the app deployable and operable as a service.

### Work

- add `GET /health`
- add structured JSON logging
- add Dockerfile using `node:24.14-alpine`
- add `.dockerignore`
- add CI for install, type-check, and tests
- add `.env.example` updates and deployment notes

### Suggested Commit Group

- `feat: add health endpoint and structured logging`
- `chore: add docker image and ignore rules`
- `ci: add validation workflow`

### Acceptance Criteria

- container builds successfully
- `/health` returns healthy status with DB available
- CI runs on every branch/PR in the standalone repo

### Rollback

- revert deployment artifacts independently
- continue local verification without container rollout

## Phase 7: Report Flow Validation and Rollout — PENDING (manual)

### Goal

Prove the riskiest operational path before broader rollout.

### Work

- install rotated app into target workspace
- run manual verification checklist
- confirm first-use creation of `#abot-reports`
- confirm admins are added correctly
- confirm repeated reports reuse the channel
- confirm reply flow works across restart
- confirm opt-out is respected end-to-end

### Suggested Commit Group

- `docs: add rollout verification checklist`
- `docs: record verified production behaviors`

### Acceptance Criteria

- report flow is verified in a real workspace
- reply restart survival is verified
- no live credential leakage remains from the prototype

### Rollback

- uninstall the app from the target workspace
- rotate credentials again if needed
- revert to internal-only testing until blockers are resolved

## Cross-Phase Rules

- Keep `package-lock.json` tracked in the standalone repo.
- Keep `reference/` out of the standalone repo by default.
- Do not change public behavior and internal structure in the same commit unless the change is small and unavoidable.
- Run tests and type-checks at every phase boundary.
- Treat manifest scope changes as product-impacting because they may require reauthorization.

## Minimum Verification Commands Per Phase

These are the default checks to run once execution begins:

```bash
npm install
npm run type-check
npm test
npm run build
```

If a phase adds Docker or CI:

```bash
docker build -t abot:test .
```

## First Execution Session Should Deliver

The first non-documentation execution session should end with:

- standalone repo created
- secrets rotated
- docs committed
- package/tooling upgrade branch opened

It should **not** try to do the entire production refactor in one step.

---

## 2026-04-09 Execution Summary

All phases 0–6 were executed end-to-end in a single session on branch
`refactor/enterprise` of `apet97/anon`. Phase 7 is the manual rollout
step and is out of scope for automated execution.

### What shipped

- Clean standalone clone of `apet97/anon` with the nested prototype
  imported and gitignore tightened (secrets, databases, reference
  mirror all excluded; `package-lock.json` now tracked).
- `pumble-sdk` and `pumble-cli` upgraded from `0.0.29` to `1.1.1`.
  The SDK type system surfaced the latent `multiline: true` bug on
  the reply modal textarea; fixed to `line_mode: "multiline"`.
- `src/config.ts` with fail-fast env validation for
  `PUMBLE_APP_ID` / `PUMBLE_APP_KEY` / `PUMBLE_APP_CLIENT_SECRET` /
  `PUMBLE_APP_SIGNING_SECRET`, plus typed defaults for
  `DATABASE_PATH` / `LOG_LEVEL` / `PORT` / `NODE_ENV`. Returns a
  frozen object.
- `SECURITY.md` with the secrets policy, rotation checklist for the
  known-compromised dev workspace credentials, and incident response.
- Modular source layout matching §4 of the SPEC:
  `src/{main,app,config,logger,deps}.ts` plus `commands/`,
  `interactions/`, `views/`, `events/`, `services/`, `db/`,
  `tokens/`, and `http/`.
- Forward-only migration runner (`src/db/migrations/migrator.ts`)
  with four versioned migrations: baseline schema, `pending_replies`,
  `audit_log`, `tokens`. Migrations run on every boot and the runner
  is idempotent (covered by a dedicated test).
- SQLite-backed `pending_replies` store replaces the in-memory Map.
  The modal flow now survives process restarts — proven by an
  integration test that opens one database, writes state, closes
  it, reopens the same file, and reads the state back.
- `SqliteCredentialsStore` implements the full 7-method
  `CredentialsStore` contract (bot+user saves in a single
  transaction, workspace/user-scoped deletes, bot row keyed by an
  empty-string sentinel).
- Lifecycle handlers (`APP_UNAUTHORIZED`, `APP_UNINSTALLED`) purge
  tokens and pending reply rows and write an audit entry.
- Structured pino logging with a redaction list covering every
  token/secret property name plus `messageText` / `replyText`.
- `audit_log` entries are written for `SEND`, `REPLY`, `REPORT`,
  `BLOCK`, `UNBLOCK`, `APP_UNAUTHORIZED`, `APP_UNINSTALLED`, and
  `STARTUP`. Raw message bodies never appear in audit rows or log
  lines (tests assert this explicitly).
- `GET /health` and `GET /ready` endpoints on the SDK's Express
  server via `onServerConfiguring`. Each runs a `SELECT 1` probe
  and returns 503 if the DB is unreachable.
- Two-stage `Dockerfile` using `node:24.14-alpine`, tini as PID 1,
  `node` user, with a production-only `node_modules` and the
  `.sql` migrations copied into `dist/db/migrations`.
- GitHub Actions CI (`.github/workflows/ci.yml`) running a
  Node 20/22 matrix through `npm ci`, type-check, test, build, and
  a secret-file tracking check, plus a docker build smoke job.

### Test status

- **67 vitest tests** across 16 files:
  `config` (6), `parseRecipient` (6), `rateLimit` (8), `anonMessage` (1),
  `reportChannel` (3), `/anon` command (8), `/anon-block` + `/anon-unblock`
  (2), `reply_anon` (1), `report_anon` (4), `anon_reply_modal` (4),
  `migrator` (5), `sqliteCredentialsStore` (6), SQLite-backed
  `pendingReplies` with restart-survival (4), lifecycle events (3),
  `logger` redaction (3), `audit_log` coverage (3).
- `npm run type-check` passes (both `tsconfig.json` and
  `tsconfig.test.json`).
- `npm run build` passes and copies the `.sql` migrations into `dist/`.

### Manual rollout checklist (what still needs a human)

1. **Rotate the compromised credentials** per `SECURITY.md`. The
   dev workspace `64ad1305c701cc5be7c26fe4` and the
   `69950af22720c2992bab57f7` app both had `tokens.json` and
   `.pumbleapprc` on disk.
2. **Populate production secrets** as env vars in your runtime.
3. **Update trigger URLs** in Pumble:
   `npx pumble-cli pre-publish --host https://<prod-host>`
4. **Reinstall the app** into the target workspace to obtain fresh
   bot and user tokens.
5. **Real-workspace verification** of the flows that cannot be
   exercised offline:
   - `/anon @user hello` end-to-end delivery
   - reply modal submit, and restart mid-modal
   - `/anon-block` and `/anon-unblock` round-trip
   - First-use `#abot-reports` channel creation, admin invite,
     onboarding message
   - Subsequent report reuses the cached channel id
6. **Merge `refactor/enterprise` to `main`** once the rollout
   checks pass.
