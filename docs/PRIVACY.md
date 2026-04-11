# Anon Privacy Notice

Anon is a Pumble anonymous-messaging bot. This document describes what
Anon stores, what it deliberately does not store, how long data is
retained, and how to contact the operators. It is a working draft
scoped to the self-hosted reference deployment and must be reviewed by
the deploying organisation before production rollout.

## Data Anon collects

Anon stores the minimum state required to route anonymous messages,
enforce rate limits, and support admin reporting.

- **Conversation records** — a generated conversation id plus the
  hashed or opaque Pumble user ids of sender and recipient, kept in the
  `conversations` table.
- **Workspace identifiers** — the Pumble workspace id associated with
  each audit and report event, used for multi-tenant isolation.
- **Pending reply state** — short-lived modal state (conversation id,
  recipient id, direction) stored in the `pending_replies` table while
  a reply modal is open.
- **Rate-limit counters** — per-sender and per-sender-target counters
  used to enforce the abuse-prevention limits defined in `SPEC.md`.
- **Audit log entries** — event type (for example `SEND`, `BLOCK`,
  `REPORT`), workspace id, actor id, target id, conversation id, and a
  small structured outcome field. Audit entries never include message
  content.
- **Blocked-user list** — the Pumble user ids of recipients who have
  run `/anon-block`.
- **Installation tokens** — Pumble bot tokens persisted through the
  `CredentialsStore` contract. These are operational secrets, not user
  content.

## Data Anon does not collect

- **Raw message bodies are never logged.** The Pino logger configured
  in `src/logger.ts` redacts message text from every log line. Only
  event type, ids, and outcome fields are emitted.
- **No profile data, email addresses, or presence data** are read or
  stored. Anon only calls the Pumble APIs it needs to deliver messages
  and post admin reports.
- **No third-party analytics, telemetry, or advertising trackers** are
  used.

## Retention

Retention defaults are enforced by a scheduled retention job. They can
be tuned per deployment but must be disclosed to users before launch.

- `pending_replies` — purged 24 hours after creation. This table holds
  transient modal state and should never accumulate rows.
- `audit_log` — 90 days by default. Required for incident response and
  for resolving reports.
- `conversations` — 90 days by default. Retained so that reply and
  report flows can resolve the original sender.
- Rate-limit counters — in-memory or short-lived, no long-term
  retention.

See `docs/SPEC.md` section 6.3 for the authoritative retention
definitions and the retention-job specification.

## Admin visibility and reporting

Sender identity is hidden from the recipient. When a recipient presses
the **Report** button on an anonymous message, Anon posts a report to
the workspace's configured `#abot-reports` channel containing the
sender id, recipient id, and original conversation id. This is the
only code path that exposes sender identity and it is gated on the
explicit report action.

## Rotation and incident response

Anon follows the rotation checklist and secret-leak procedure defined
in the repository root `SECURITY.md`:

- `SECURITY.md` section **Rotation checklist** — routine credential
  rotation steps.
- `SECURITY.md` section **What to do if a secret leaks** — incident
  response runbook for leaked tokens or app secrets.

Operators must rotate the Pumble client secret, signing secret, and
any installation tokens before the first production deployment.

## Contact

Security reports and privacy questions should be routed to a real
operator mailbox. The placeholder `security@anon.example.com` is used
throughout the reference repository and **must be replaced** with a
monitored address before the app is published to the Pumble
marketplace.

## Status

This document is a scaffold created as part of F-P8. It will be
expanded with the final hosted URL, legal entity, and contact mailbox
once the deployment target is chosen.
