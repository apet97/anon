# Abot PRD

**Status:** draft v2  
**Date:** 2026-04-08  
**Audience:** stakeholders, workspace admins, engineering

## 1. Product Summary

Abot is a Pumble app for anonymous direct messaging inside a workspace. A user sends `/anon @user message`, the recipient gets a bot DM with the message, and either side can continue the conversation through anonymous replies. The recipient can also report a message, which reveals the sender's identity to workspace admins in a private reports channel.

Abot is not a true-anonymity product. It is a **pseudonymous messaging tool with admin accountability**. The product promise is:

- Anonymous to the other participant
- Accountable to workspace admins when reported
- Safe enough for candid feedback without becoming a harassment vector

## 2. Problem Statement

Abot exists to solve three problems in Pumble workspaces:

1. People sometimes avoid giving candid feedback because identity is attached to every normal DM.
2. Workspace members need a low-friction way to send sensitive feedback or questions without starting a visible thread or formal HR workflow.
3. If anonymous messaging is allowed, abuse handling must be built into the same workflow instead of being an afterthought.

## 3. Goals

- Enable one-to-one anonymous messaging inside a single Pumble workspace.
- Allow two-way anonymous replies without exposing identities in the client UI.
- Give recipients a one-click abuse reporting path.
- Add enough friction and auditability to discourage harassment and spam.
- Make the product operationally supportable in production.

## 4. Non-Goals

- True anonymity from operators or admins
- Group anonymous messaging
- Cross-workspace messaging
- Anonymous file sharing
- Full moderation dashboard
- Rich content authoring beyond simple text + bot blocks

## 5. Users

| Persona | Need | What Abot provides |
| --- | --- | --- |
| Sender | Send candid feedback privately | `/anon @user message` |
| Recipient | Read and optionally answer anonymous messages | DM with Reply and Report actions |
| Workspace admin / owner | Investigate abuse when needed | Private `#abot-reports` channel with sender identity |
| Opted-out user | Stop receiving anonymous messages | `/anon-block` and `/anon-unblock` |

## 6. Product Behavior

### 6.1 Happy Path: Send

1. Sender runs `/anon @recipient message`.
2. Abot acknowledges quickly and validates the request.
3. Recipient receives a DM from the bot with:
   - anonymous message label
   - quoted message body
   - `Reply Anonymously` button
   - `Report` button
4. Recipient does not see the sender identity.

### 6.2 Happy Path: Reply

1. Recipient clicks `Reply Anonymously`.
2. Abot opens a modal with a single multiline text field.
3. Recipient submits the modal.
4. The other participant receives a new anonymous DM with the reply and the same actions.
5. The flow repeats without identity disclosure in the conversation UI.

### 6.3 Happy Path: Opt Out

1. User runs `/anon-block`.
2. Future sends targeting that user are rejected before delivery.
3. User can re-enable delivery with `/anon-unblock`.

## 7. Abuse and Risk Model

Abot should be treated as a controlled-risk feature, not a trust exercise.

### Risks

- Targeted harassment
- Spam bursts
- Repeated unwanted contact toward one person
- False perception of “untraceable” anonymity
- Operational failure of the report path

### Product Controls

| Control | Intent |
| --- | --- |
| Global rate limit | Stop burst spam from one sender |
| Per-target rate limit | Stop focused harassment of one recipient |
| Length limit | Reduce abuse payload size and noise |
| Opt-out | Give recipients unilateral inbox control |
| Self-send block | Remove pointless and noisy use |
| Report button | Put accountability in the recipient flow |
| Admin-only reports channel | Limit sensitive identity exposure |
| Server-side audit trail | Support investigation and operational response |

### Product Positioning

All user-facing copy should make this explicit:

> Anonymous to the other person, not to workspace admins. Abuse can be reported.

## 8. Current Prototype vs Target Product

The current prototype already demonstrates the core user experience:

- `/anon`
- `/anon-block`
- `/anon-unblock`
- anonymous reply modal
- report button
- basic SQLite-backed conversation and rate-limit storage

The current prototype is **not production-ready** because:

- reply-modal state is still kept in memory and is lost on restart
- production-safe secret handling is not in place
- report flow has not been verified end-to-end in production
- observability and health checks are missing
- the codebase is a single `src/main.ts`

## 9. Success Metrics

### User/Product Metrics

- Recipients can understand and act on a message without any training.
- Abuse reports reach admins reliably on first use.
- Opt-out is respected 100 percent of the time.
- Anonymous reply flow survives process restarts.

### Operational Metrics

| Metric | Target |
| --- | --- |
| Slash-command ack latency p95 | under 1 second |
| DM delivery success | 99.5 percent or better |
| Report channel first-use success | 100 percent in verified rollout testing |
| Silent failures | zero tolerated |
| Secret files committed to git | zero |

## 10. Launch Readiness Gates

Abot is not ready for production until all of the following are true:

1. Live credentials in `tokens.json` and `.pumbleapprc` have been rotated.
2. A standalone git repo workflow exists for the app.
3. Reply state is durable across restarts.
4. Signature verification is confirmed in the production path.
5. Report flow is tested end-to-end.
6. Health checks, structured logging, and a deployable container image exist.

## 11. Out of Scope for This Cycle

- Admin review dashboard
- Attachments and media
- Multi-workspace tenancy in one deployment
- Redis-based infrastructure
- Public marketplace packaging polish beyond what is required to deploy safely
- Advanced moderation features such as auto-suspension, keyword policies, or reviewer workflows

## 12. References

- Technical design: [SPEC.md](./SPEC.md)
- Delivery roadmap: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
- Local Pumble reference mirror reviewed during planning: `reference/`
- Additional local docs reviewed during planning: `/Users/15x/Downloads/WORKING/addons-me/devodox/`
