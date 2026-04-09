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
 *  2. load the pending-reply row, delete it, and flip the direction
 *     so the reply is routed to the original sender (or original
 *     recipient, if the sender is replying to an anonymous reply).
 *  3. send the reply via the shared anonMessage service.
 *
 * On close: ack and delete the pending row.
 */
export type ModalHandler = (ctx: ViewActionContext) => Promise<void>;

interface ReplyBlockState {
  reply_block?: { reply_text?: { value?: string } };
}

function flip(direction: ReplyDirection): ReplyDirection {
  return direction === "recipient" ? "sender" : "recipient";
}

export function makeAnonReplyModalSubmit(deps: AppDeps): ModalHandler {
  return async (ctx) => {
    await ctx.ack();

    const userId = ctx.payload.userId;
    const workspaceId = ctx.payload.workspaceId;
    const pending = await deps.pendingReplies.get(workspaceId, userId);
    await deps.pendingReplies.delete(workspaceId, userId);

    if (!pending) {
      deps.logger.warn(
        { eventType: "REPLY", actorId: userId, outcome: "no-pending" },
        "reply submit without pending state",
      );
      return;
    }

    const state = ctx.payload.view.state as ReplyBlockState | undefined;
    const replyText = state?.reply_block?.reply_text?.value;
    if (!replyText) {
      deps.logger.warn(
        { eventType: "REPLY", convId: pending.convId, outcome: "empty" },
        "reply submit empty",
      );
      return;
    }

    if (replyText.length > MAX_MESSAGE_LENGTH) {
      deps.logger.warn(
        { eventType: "REPLY", convId: pending.convId, outcome: "too-long" },
        "reply submit too long",
      );
      return;
    }

    const conv = deps.repos.conversations.get(pending.convId);
    if (!conv) {
      deps.logger.error(
        { eventType: "REPLY", convId: pending.convId, outcome: "conv-not-found" },
        "reply submit for unknown conversation",
      );
      return;
    }

    const targetId =
      pending.direction === "recipient" ? conv.sender_id : conv.recipient_id;
    const newDirection = flip(pending.direction);

    const client = await ctx.getBotClient();
    if (!client) {
      deps.logger.error(
        { eventType: "REPLY", convId: pending.convId, outcome: "no-bot-client" },
        "reply submit with no bot client",
      );
      return;
    }

    try {
      const sent = await deps.anonMessage.send({
        client,
        targetId,
        label: "Anonymous reply",
        messageText: replyText,
        convId: pending.convId,
        direction: newDirection,
      });
      deps.logger.info(
        {
          eventType: "REPLY",
          convId: pending.convId,
          actorId: userId,
          targetId,
          outcome: sent ? "ok" : "no-channel",
        },
        "anon reply processed",
      );
    } catch (err) {
      deps.logger.error(
        {
          eventType: "REPLY",
          convId: pending.convId,
          outcome: "error",
          err: (err as Error).message,
        },
        "failed to send anonymous reply",
      );
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
