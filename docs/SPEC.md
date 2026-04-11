# Anon Technical Specification

**Status:** draft v2  
**Date:** 2026-04-08  
**Audience:** engineers and operators  
**Current runtime:** Node + TypeScript prototype  
**Current dependencies:** `pumble-sdk@0.0.29`, `pumble-cli@0.0.29`  
**Target published versions verified on 2026-04-08:** `pumble-sdk@1.1.1`, `pumble-cli@1.1.1`

This document describes the target production architecture for Anon and the migration path from the current prototype. It intentionally reflects the verified current state of the repo rather than the stale assumptions in earlier notes.

## 1. Verified Current State

The following facts were confirmed directly from the working tree:

- The app implementation lives entirely in [`src/main.ts`](../src/main.ts).
- The current prototype already uses SQLite through `better-sqlite3`.
- Existing persisted tables today are:
  - `conversations`
  - `blocked_users`
  - `rate_limits`
  - `target_limits`
  - `config`
- The only clearly ephemeral conversation state today is `pendingReplies`, which is an in-memory `Map`.
- The report flow exists in code, including private-channel creation and admin invitation, but has not been verified in production.
- `tokens.json` contains live JWT-bearing credentials for workspace `64ad1305c701cc5be7c26fe4`.
- The folder `/Users/15x/Downloads/WORKING/addons-me/abot` is not a standalone repo. It is nested inside the parent git repo `/Users/15x/Downloads/WORKING`, whose remote is unrelated to the target `apet97/anon` repo.

## 2. Goals for the Technical Refactor

- Move from a single-file prototype to a maintainable modular service.
- Preserve existing user-facing behavior unless the PRD or security model requires change.
- Make anonymous reply state restart-safe.
- Move from local prototype secrets to production-safe configuration.
- Add predictable deployment, health, logging, and verification workflows.

## 3. Architecture Overview

### 3.1 Runtime Topology

```text
Pumble -> HTTPS -> reverse proxy / load balancer -> Node app -> SQLite file
```

### 3.2 Request Classes

- `POST /hook`
  - slash commands
  - block interactions
  - view actions
  - lifecycle events
- `GET /health`
  - readiness/liveness endpoint
- `GET /manifest`
  - served by the SDK / app runtime configuration path

### 3.3 Target Responsibilities

| Layer | Responsibility |
| --- | --- |
| `src/main.ts` | bootstrap only |
| `src/app.ts` | construct `App` object and register routes/triggers |
| `src/config.ts` | environment parsing and startup validation |
| `src/commands/` | slash-command handlers |
| `src/interactions/` | block button handlers |
| `src/views/` | modal submit/close handlers |
| `src/events/` | lifecycle event handlers |
| `src/services/` | business logic |
| `src/db/` | database connection, migrations, repositories |
| `src/tokens/` | custom credentials store |
| `src/http/` | `/health` and any future non-Pumble routes |
| `src/logger.ts` | structured logging setup |

## 4. Trigger Matrix

| Trigger | Current | Target handler area | Notes |
| --- | --- | --- | --- |
| `/anon` | implemented | `commands/anon.ts` | preserve behavior, improve structure |
| `/anon-block` | implemented | `commands/anonBlock.ts` | preserve behavior |
| `/anon-unblock` | implemented | `commands/anonUnblock.ts` | preserve behavior |
| `reply_anon` button | implemented | `interactions/replyAnon.ts` | no `ctx.ack()` before opening modal |
| `report_anon` button | implemented | `interactions/reportAnon.ts` | posts to report channel, then `ctx.ack()` |
| `anon_reply_modal` submit | implemented | `views/anonReplyModal.ts` | must `ctx.ack()` |
| `anon_reply_modal` close | implemented | `views/anonReplyModal.ts` | must `ctx.ack()` and cleanup pending state |
| `APP_UNAUTHORIZED` | implemented | `events/appUnauthorized.ts` | cleanup user credentials |
| `APP_UNINSTALLED` | implemented | `events/appUninstalled.ts` | cleanup workspace credentials and workspace data |

## 5. Pumble SDK Rules That Matter for Anon

These are binding implementation rules for future sessions:

- Slash commands and shortcuts must `ctx.ack()` within 3 seconds.
- Do **not** `ctx.ack()` when opening, pushing, or updating a modal.
- `viewAction.onSubmit` must `ctx.ack()`.
- `viewAction.onClose` must `ctx.ack()`.
- Message block interaction payload values are carried inside parsed payload JSON, not directly as plain fields.
- Slash-command mentions are formatted as `<<@USER_ID>>`.
- `ctx.payload.view.state.values` is keyed by `blockId` and then by the inner element `onAction`.
- `CredentialsStore` is a 7-method interface in current SDK docs and must include:
  - `getBotToken`
  - `getUserToken`
  - `getBotUserId`
  - `saveTokens`
  - `deleteForWorkspace`
  - `deleteForUser`
  - `initialize`

Relevant 2026-04-08 doc-sync additions such as `ViewBuilder`, modal-safe `section` and `divider`, and expanded input element types are useful for future UX iteration, but they are not required to achieve Anon’s first production-grade version.

## 6. Data Model

### 6.1 Current Persisted Tables

These already exist in the prototype and should be preserved through migrations:

#### `conversations`

Stores conversation identity, the latest message preview, and the routing context for reply-button handling.

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,         -- empty string for channel/thread posts
  last_message TEXT,
  message_type TEXT NOT NULL DEFAULT 'dm',  -- 'dm' | 'channel' | 'thread'
  channel_id TEXT,                    -- channel where message was posted (channel/thread only)
  thread_root_id TEXT,                -- Pumble message ID of the original channel post
                                      -- (captured from postMessageToChannel response);
                                      -- used as the thread root for Reply button flows
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

The `message_type`, `channel_id`, and `thread_root_id` columns were added in migration `006_channel_thread.sql` to support the three `/anon` contexts. The reply modal submit handler reads `message_type` to decide whether the reply goes back as a DM (`anonMessage.send`) or as a thread reply under the original channel post (`anonMessage.replyInThread` using `thread_root_id` as the Pumble message ID).

#### `blocked_users`

```sql
CREATE TABLE blocked_users (
  user_id TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `rate_limits`

```sql
CREATE TABLE rate_limits (
  user_id TEXT PRIMARY KEY,
  msg_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `target_limits`

```sql
CREATE TABLE target_limits (
  sender_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (sender_id, target_id)
);
```

#### `config`

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 6.2 New Tables Required for Production

#### `pending_replies`

Purpose: replace the in-memory `pendingReplies` map so modal submits survive restarts.

```sql
CREATE TABLE pending_replies (
  user_id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('recipient', 'sender')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### `audit_log`

Purpose: capture sensitive events without writing raw message bodies to application logs.

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL DEFAULT (unixepoch()),
  workspace_id TEXT,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  conv_id TEXT,
  metadata_json TEXT
);
```

#### `tokens`

Purpose: back a custom SQLite credentials store so the app can leave `tokens.json`.

```sql
CREATE TABLE tokens (
  workspace_id TEXT NOT NULL,
  workspace_user_id TEXT,
  bot_user_id TEXT,
  access_token TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('bot', 'user')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (workspace_id, workspace_user_id, token_kind)
);
```

#### `schema_migrations`

Purpose: track applied migrations.

```sql
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### 6.3 Retention Policy

- `pending_replies`: purge stale rows after 24 hours
- `audit_log`: default retention 90 days
- `conversations`: retain operationally useful history, default 90 days unless a workspace-specific requirement changes it later
- `tokens`: remove on uninstall or user unauthorized events

## 7. Anonymous Reply State Machine

### 7.1 Conversation Send

1. Sender submits `/anon`.
2. App validates:
   - mention exists
   - message body exists
   - sender is not target
   - recipient has not opted out
   - message length <= max
   - sender passes global limit
   - sender-target pair passes per-target limit
3. App inserts or creates conversation state.
4. App resolves DM channel and posts anonymous message blocks.

### 7.2 Reply Button

1. Recipient clicks `Reply Anonymously`.
2. App persists or upserts:
   - `user_id`
   - `conv_id`
   - `direction`
3. App opens modal.
4. No `ctx.ack()` before modal open.

### 7.3 Reply Submit

1. Modal submit handler `ctx.ack()`s.
2. App loads `pending_replies` row for the submitting user.
3. App loads the `conversations` row and branches on `message_type`:
   - `dm` → compute target user from `sender_id`/`recipient_id` and the stored direction, then `anonMessage.send`
   - `channel` or `thread` → post an anonymous thread reply under the original message via `anonMessage.replyInThread(thread_root_id, channel_id, ...)`
4. App updates `conversations.last_message`.
5. App deletes consumed `pending_replies` row.
6. App records audit event.

### 7.4 Reply Cancel / Close

1. Modal close handler `ctx.ack()`s.
2. App deletes the user’s `pending_replies` row.

### 7.5 Restart Behavior

If the process restarts after modal open but before submit:

- the modal still exists in the user UI
- the `pending_replies` row still exists in SQLite
- submit continues successfully after restart

This is the primary correctness improvement over the current prototype.

## 8. Rate-Limiting Policy

The production design preserves the prototype policy unless abuse testing proves it insufficient.

### 8.1 Global Limit

- 20 sends per sender per 60-second fixed window (applies to DMs, channel posts, and thread replies alike)

### 8.2 Per-Target Limit

- 10 sends from one sender to one target per 1-hour fixed window
- For DMs, "target" = recipient workspace user ID
- For channel posts and thread replies, "target" = channel ID (prevents one sender from flooding a single channel anonymously)

### 8.3 Enforcement Order

DM path:

1. self-send check
2. opt-out check (recipient `blocked_users`)
3. length check
4. global limit
5. per-target limit (sender → recipient)
6. delivery

Channel / thread path:

1. length check (no self or block checks — no specific recipient)
2. global limit
3. per-target limit (sender → channel)
4. delivery via `postMessageToChannel` (channel) or `messages.reply` (thread)

### 8.4 Rationale

- The prototype already uses fixed-window counters and SQLite.
- SQLite keeps operational complexity low.
- Single-process deployment is the target for v1, so Redis is unnecessary.

## 9. Security and Privacy Model

### 9.1 Credential Risk Identified

`tokens.json` currently contains live JWTs for workspace `64ad1305c701cc5be7c26fe4`. Those credentials are gitignored but are still sensitive and must be rotated before any production work or repo extraction.

### 9.2 Secrets Handling Requirements

Production must not depend on `.pumbleapprc`.

Required environment variables:

- `PUMBLE_APP_ID`
- `PUMBLE_APP_KEY`
- `PUMBLE_APP_CLIENT_SECRET`
- `PUMBLE_APP_SIGNING_SECRET`
- `DATABASE_PATH`
- `LOG_LEVEL`

### 9.3 Signature Verification

Production must rely on the Pumble signing secret and the SDK/runtime path that verifies:

- `x-pumble-request-timestamp`
- `x-pumble-request-signature`

Important nuance:

- The prototype uses `start(addon)` and works in a CLI/dev flow.
- That is not enough to treat production verification as complete.
- Production startup must fail closed if required app secrets are missing.
- The implementation phase must prove signature verification by test, not assumption.

### 9.4 PII Rules

| Data | May be stored | May be logged | May be exposed to recipient | May be exposed to admins |
| --- | --- | --- | --- | --- |
| sender user ID | yes | only structurally | no | yes, on report |
| recipient user ID | yes | only structurally | n/a | operationally only |
| message body | yes, minimally | no raw body in app logs | yes, anonymously | yes, in report context |
| tokens/secrets | yes, in secure store only | never | no | no |

### 9.5 Audit Events

Audit log should capture at least:

- `SEND`
- `REPLY`
- `REPORT`
- `BLOCK`
- `UNBLOCK`
- `APP_UNAUTHORIZED`
- `APP_UNINSTALLED`
- delivery failures
- rate-limit denials

### 9.6 Report Flow Privacy

The report path intentionally breaks anonymity for admins only. The report payload should include:

- reporter identity
- sender identity
- conversation ID
- recent message preview

No broader exposure is allowed.

## 10. Deployment and Operations

### 10.1 Container

Use the documented two-stage Docker pattern from the Pumble production docs:

```dockerfile
FROM node:24.14-alpine AS builder
WORKDIR /root/
COPY . .
RUN npm ci
RUN npm run compile

FROM node:24.14-alpine
WORKDIR /root/
COPY --from=builder /root/dist ./dist
COPY --from=builder /root/package.json .
COPY --from=builder /root/manifest.json .
COPY --from=builder /root/node_modules node_modules/
CMD ["node", "dist/main.js"]
```

Anon may add minor production conveniences later such as `tini`, but this is the base deployment shape to follow.

### 10.2 Health

Add `GET /health` with at least:

- process alive
- database openable
- migrations current

### 10.3 Logging

Add structured JSON logging with fields such as:

- `handler`
- `workspaceId`
- `userId`
- `convId`
- `eventType`
- `outcome`

Never log raw secrets or message bodies.

### 10.4 Error Tracking

Add a pluggable error-reporting integration point, but do not block productionization on a specific vendor. Structured logs are the minimum required baseline.

## 11. Git Reconciliation Strategy

This is a key part of the technical plan because the current folder is nested inside the wrong repo.

### 11.1 Current Problem

- Current folder is inside parent repo `/Users/15x/Downloads/WORKING`
- Parent repo remote is `https://github.com/apet97/WORKING.git`
- Target app repo is `https://github.com/apet97/anon`
- The parent worktree already contains unrelated modifications

### 11.2 Decision

Do **not**:

- run `git init` inside `abot`
- treat the nested folder as the long-term repo root
- reconcile app history inside the noisy parent repo

### 11.3 Required Approach

1. Clone `https://github.com/apet97/anon` into a clean standalone directory outside the parent worktree noise.
2. Copy only vetted Anon files into that clone.
3. Exclude secrets, databases, and local-only research mirrors by default.
4. Commit documentation first.
5. Perform refactor phases from the standalone repo.

This is lower-risk than in-place git surgery and prevents accidental inclusion of unrelated parent-repo state.

## 12. Tracking and Inclusion Rules for the Standalone Repo

### Include

- `src/`
- `docs/`
- `README.md`
- `manifest.json`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `.env.example`
- future Docker / CI / test files

### Exclude

- `tokens.json`
- `.pumbleapprc`
- `.env`
- `conversations.db*`
- local `.DS_Store`
- `node_modules/`
- `dist/`

## 13. Test Strategy

### 13.1 Unit Tests

- mention parsing
- rate-limit calculations
- repository behavior
- report-channel resolution helpers

### 13.2 Integration Tests

- `/anon` happy path
- `/anon-block` and `/anon-unblock`
- anonymous reply flow
- restart survivability of modal reply
- report flow and channel creation
- lifecycle cleanup events
- health endpoint

### 13.3 Security Verification

- invalid signature rejected
- missing secrets cause startup failure
- tokens are cleaned up on uninstall / unauthorized

### 13.4 Manual Verification Before Production

- install app into target workspace
- verify `/anon`
- verify reply flow
- verify `/anon-block`
- verify `/anon-unblock`
- verify first-ever `#abot-reports` creation
- verify repeated reports reuse the same channel
- verify rotated credentials only

## 14. Resolved Assumptions

- SQLite is the production persistence choice for v1.
- Redis is out of scope for this refactor.
- The target SDK/CLI upgrade target is `1.1.1`.
- `reaction:read` is not required by any handler and is intentionally omitted from `manifest.json` to narrow the install consent screen.
- Documentation and repo extraction happen before any major code refactor.

## 15. Source Material Used for This Spec

- Pumble SDK docs mirrored from upstream commit `5d631d2`; package versions verified against npm on 2026-04-08.
