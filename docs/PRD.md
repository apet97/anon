# Anon PRD

**Status:** v2 (production)  
**Date:** 2026-04-08  
**Audience:** stakeholders, workspace admins, engineering

## 1. Product Summary

Anon is a Pumble app for anonymous messaging inside a workspace. It supports three contexts from a single `/anon` command:

- **Anonymous DM** — `/anon @user message` sends a bot DM to the target user
- **Anonymous channel post** — `/anon message` (no @mention) posts as the bot in the current channel
- **Anonymous thread reply** — `/anon message` inside a thread posts an anonymous thread reply

In all three cases the recipient(s) never see the sender's identity, but they can click **Reply Anonymously** to continue the conversation or **Report** to forward the message to workspace admins with the sender's identity revealed in a private reports channel.

Anon is not a true-anonymity product. It is a **pseudonymous messaging tool with admin accountability**. The product promise is:

- Anonymous to the other participant
- Accountable to workspace admins when reported
- Safe enough for candid feedback without becoming a harassment vector

## 2. Problem Statement

Anon exists to solve three problems in Pumble workspaces:

1. People sometimes avoid giving candid feedback because identity is attached to every normal DM.
2. Workspace members need a low-friction way to send sensitive feedback or questions without starting a visible thread or formal HR workflow.
3. If anonymous messaging is allowed, abuse handling must be built into the same workflow instead of being an afterthought.

## 3. Goals

- Enable anonymous messaging inside a single Pumble workspace in three contexts: one-to-one DMs, channel posts, and thread replies.
- Allow two-way anonymous replies without exposing identities in the client UI.
- Give recipients a one-click abuse reporting path.
- Add enough friction and auditability to discourage harassment and spam.
- Make the product operationally supportable in production.

## 4. Non-Goals

- True anonymity from operators or admins
- Group anonymous messaging
- Cross-workspace messaging (messages between different workspaces)
- Anonymous file sharing
- Full moderation dashboard
- Rich content authoring beyond simple text + bot blocks

Multi-workspace tenancy (simultaneous installation on multiple workspaces with full data isolation) is supported as of migration 007.

## 5. Users

| Persona | Need | What Anon provides |
| --- | --- | --- |
| Sender | Send candid 1:1 feedback privately | `/anon @user message` |
| Sender | Post anonymous team feedback in a shared channel | `/anon message` (no @mention) |
| Sender | Chime in on a discussion anonymously | `/anon message` inside a thread |
| Recipient | Read and optionally answer anonymous messages | Message with Reply and Report actions |
| Workspace admin / owner | Investigate abuse when needed | Private `#abot-reports` channel with sender identity |
| Opted-out user | Stop receiving anonymous DMs | `/anon-block` and `/anon-unblock` |

## 6. Product Behavior

### 6.1 Happy Path: Send (DM)

1. Sender runs `/anon @recipient message`.
2. Anon acknowledges quickly and validates the request.
3. Recipient receives a DM from the bot with:
   - anonymous message label
   - quoted message body
   - `Reply Anonymously` button
   - `Report` button
4. Recipient does not see the sender identity.

### 6.2 Happy Path: Send (channel / thread)

1. Sender runs `/anon message` in a channel (for a channel post) or inside an existing thread (for a thread reply).
2. Anon acknowledges quickly. Detection rule: text starting with `<<@USER_ID>>` is a DM; otherwise, presence of `threadRootId` on the slash-command payload selects thread-reply mode; otherwise channel-post mode.
3. Anon posts the message as the bot in the target location with the same Reply/Report buttons.
4. No one in the channel or thread can see the sender.

### 6.3 Happy Path: Reply

1. Recipient clicks `Reply Anonymously` on any anonymous message.
2. Anon opens a modal with a single multiline text field.
3. Recipient submits the modal.
4. The reply is routed back through the **same context** as the original:
   - original was a DM → the other participant gets a new anonymous DM
   - original was a channel post or thread reply → the reply posts as an anonymous thread reply under the original message
5. The flow repeats without identity disclosure in the conversation UI.

### 6.4 Happy Path: Opt Out

1. User runs `/anon-block`.
2. Future anonymous **DMs** targeting that user are rejected before delivery.
3. User can re-enable delivery with `/anon-unblock`.
4. Note: the block list only covers DMs. Channel posts and thread replies have no specific recipient, so block status does not apply.

## 7. Abuse and Risk Model

Anon should be treated as a controlled-risk feature, not a trust exercise.

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

Anon is not ready for production until all of the following are true:

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
- Privacy policy: [PRIVACY.md](./PRIVACY.md)
