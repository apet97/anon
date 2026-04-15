import type { ViewActionContext } from "pumble-sdk/lib/core/types/contexts";
import type { AppDeps } from "../deps";
import { MAX_MESSAGE_LENGTH } from "../services/anonMessage";
import type { ReplyDirection } from "../services/pendingReplies";

/**
 * `anon_reply_modal` view action — handles the submit and close
 * events from the reply modal.
 *
 * On submit:
 *  1. ack the HTTP round trip (SDK rule for onSubmit).
 *  2. validate text, enforce rate-limits and block-list.
 *  3. send the reply via the shared anonMessage service.
 *  4. delete the pending-reply row only after a successful send so the
 *     row survives a mid-send process crash (24-hour retention cleans up).
 *
 * On close: ack and delete the pending row.
 */
export type ModalHandler = (ctx: ViewActionContext) => Promise<void>;

function flip(direction: ReplyDirection): ReplyDirection {
  return direction === "recipient" ? "sender" : "recipient";
}

export function makeAnonReplyModalSubmit(deps: AppDeps): ModalHandler {
  return async (ctx) => {
    await ctx.ack();

    const userId = ctx.payload.userId;
    const workspaceId = ctx.payload.workspaceId;

    // Fetch pending state — do NOT delete yet; deletion happens only after a
    // successful send so a crash mid-send doesn't silently discard the reply.
    const pending = await deps.pendingReplies.get(workspaceId, userId);

    if (!pending) {
      deps.logger.warn(
        { eventType: "REPLY", actorId: userId, outcome: "no-pending" },
        "reply submit without pending state",
      );
      return;
    }

    // ctx.viewState is the SDK-typed V1.State (values keyed by blockId then onAction).
    // The union { type, value } | { type, values[] } requires a cast to reach .value.
    const rawEntry = ctx.viewState?.values?.["reply_block"]?.["reply_text"];
    const replyText = (rawEntry as { value?: string } | undefined)?.value?.trim();

    if (!replyText) {
      deps.logger.warn(
        { eventType: "REPLY", convId: pending.convId, outcome: "empty" },
        "reply submit empty",
      );
      // H-5: hard-validation — clear the stale pending row so the next
      // modal open doesn't loop on the same broken state.
      await deps.pendingReplies.delete(workspaceId, userId);
      return;
    }

    if (replyText.length > MAX_MESSAGE_LENGTH) {
      deps.logger.warn(
        { eventType: "REPLY", convId: pending.convId, outcome: "too-long" },
        "reply submit too long",
      );
      await deps.pendingReplies.delete(workspaceId, userId);
      return;
    }

    // C-3: scope by workspaceId so a leaked convId from another workspace
    // can never surface a row here.
    const conv = deps.repos.conversations.get(workspaceId, pending.convId);
    if (!conv) {
      deps.logger.error(
        { eventType: "REPLY", convId: pending.convId, outcome: "conv-not-found" },
        "reply submit for unknown conversation",
      );
      await deps.pendingReplies.delete(workspaceId, userId);
      return;
    }

    const isChannelOrThread = conv.message_type === "channel" || conv.message_type === "thread";

    // Channel/thread conversations must carry a channel_id — the schema
    // allows NULL (for legacy DM rows), so guard explicitly instead of
    // asserting. A missing value here means either a writer bug or a
    // corrupt row; fail closed with an audit trail.
    if (isChannelOrThread && !conv.channel_id) {
      deps.logger.error(
        { eventType: "REPLY", convId: pending.convId, outcome: "missing-channel-id" },
        "channel/thread conversation is missing channel_id",
      );
      deps.auditLog.record({
        eventType: "REPLY", workspaceId, actorId: userId,
        convId: pending.convId, metadata: { outcome: "missing-channel-id" },
      });
      // H-5: corrupt row — retry won't help; clear the pending state.
      await deps.pendingReplies.delete(workspaceId, userId);
      return;
    }

    const targetId = isChannelOrThread
      ? (conv.channel_id as string)
      : pending.direction === "recipient" ? conv.sender_id : conv.recipient_id;
    const newDirection = flip(pending.direction);

    if (!isChannelOrThread) {
      if (userId === targetId) {
        deps.logger.warn(
          { eventType: "REPLY", convId: pending.convId, outcome: "self-reply" },
          "reply submit self-targeting blocked",
        );
        // H-5: self-reply is deterministic — retry with the same state
        // will fail the same way. Clear the pending row.
        await deps.pendingReplies.delete(workspaceId, userId);
        return;
      }
      if (deps.repos.blockedUsers.isBlocked(workspaceId, targetId)) {
        deps.logger.warn(
          { eventType: "REPLY", convId: pending.convId, outcome: "recipient-blocked" },
          "reply submit to blocked recipient",
        );
        deps.auditLog.record({
          eventType: "REPLY", workspaceId, actorId: userId, targetId,
          convId: pending.convId, metadata: { outcome: "recipient-blocked" },
        });
        return;
      }
    }

    if (!deps.rateLimit.checkGlobal(workspaceId, userId)) {
      deps.logger.warn(
        { eventType: "REPLY", convId: pending.convId, outcome: "rate-limited-global" },
        "reply submit rate-limited (global)",
      );
      deps.auditLog.record({
        eventType: "REPLY", workspaceId, actorId: userId, targetId,
        convId: pending.convId, metadata: { outcome: "rate-limited-global" },
      });
      return;
    }

    if (!deps.rateLimit.checkTarget(workspaceId, userId, targetId)) {
      deps.logger.warn(
        { eventType: "REPLY", convId: pending.convId, outcome: "rate-limited-target" },
        "reply submit rate-limited (target pair)",
      );
      deps.auditLog.record({
        eventType: "REPLY", workspaceId, actorId: userId, targetId,
        convId: pending.convId, metadata: { outcome: "rate-limited-target" },
      });
      return;
    }

    const client = await ctx.getBotClient();
    if (!client) {
      deps.logger.error(
        { eventType: "REPLY", convId: pending.convId, outcome: "no-bot-client" },
        "reply submit with no bot client",
      );
      return;
    }

    try {
      let sent: boolean;
      if (isChannelOrThread && conv.channel_id) {
        const threadRoot = conv.thread_root_id ?? pending.convId;
        await deps.anonMessage.replyInThread({
          client, threadRootId: threadRoot, channelId: conv.channel_id,
          messageText: replyText, convId: pending.convId,
        });
        sent = true;
      } else {
        sent = await deps.anonMessage.send({
          client, targetId, label: "Anonymous reply",
          messageText: replyText, convId: pending.convId, direction: newDirection,
        });
      }

      await deps.pendingReplies.delete(workspaceId, userId);

      deps.logger.info(
        { eventType: "REPLY", convId: pending.convId, actorId: userId, targetId,
          outcome: sent ? "ok" : "no-channel" },
        "anon reply processed",
      );
      deps.auditLog.record({
        eventType: "REPLY", workspaceId, actorId: userId, targetId,
        convId: pending.convId, metadata: { outcome: sent ? "ok" : "no-channel" },
      });
    } catch (err) {
      deps.logger.error(
        { eventType: "REPLY", convId: pending.convId, outcome: "error",
          err: (err as Error).message },
        "failed to send anonymous reply",
      );
      deps.auditLog.record({
        eventType: "REPLY", workspaceId, actorId: userId, targetId,
        convId: pending.convId, metadata: { outcome: "reply-failed", err: (err as Error).message },
      });
    }
  };
}

export function makeAnonReplyModalClose(deps: AppDeps): ModalHandler {
  return async (ctx) => {
    await ctx.ack();
    await deps.pendingReplies.delete(
      ctx.payload.workspaceId,
      ctx.payload.userId,
    );
  };
}
