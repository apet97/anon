# Abot Implementation Plan

**Status:** ready for execution after doc review  
**Date:** 2026-04-08  
**Constraint:** do not refactor inside the current nested working folder; move execution to a standalone repo first

## Overview

This plan converts Abot from a prototype into a production-ready Pumble app in controlled phases. The order matters:

1. separate the repo safely
2. rotate secrets
3. align runtime and tooling
4. characterize behavior with tests
5. refactor structure without changing behavior
6. add durable state, security hardening, and ops support
7. verify production workflows before rollout

## Phase 0: Standalone Repo Extraction and Secret Rotation

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

## Phase 1: Runtime and Tooling Alignment

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

## Phase 2: Test Harness and Baseline Characterization

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

## Phase 3: Module Split Without Behavioral Change

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

## Phase 4: Durable State and Data Migrations

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

## Phase 5: Security Hardening

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

## Phase 6: Operations and Deployment

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

## Phase 7: Report Flow Validation and Rollout

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
