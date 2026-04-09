import type { BlockInteractionContext } from "pumble-sdk/lib/core/types/contexts";
import type { AppDeps } from "../deps";
import type { ReplyDirection } from "../services/pendingReplies";

type MessageBlockInteractionCtx = BlockInteractionContext<"MESSAGE">;

/**
 * `reply_anon` button handler — opens the anonymous reply modal.
 *
 * Ack rule: **do not** call `ctx.ack()` here. The Pumble SDK sends
 * the modal as the HTTP response, and calling ack first would
 * silently drop the modal (see pumble-sdk-gotchas).
 *
 * Modal textarea uses `line_mode: "multiline"` (the SDK 1.1.1
 * property); the legacy `multiline: true` is silently ignored.
 */
export type ReplyAnonHandler = (ctx: MessageBlockInteractionCtx) => Promise<void>;

export function makeReplyAnonHandler(deps: AppDeps): ReplyAnonHandler {
  return async (ctx) => {
    const raw = JSON.parse(ctx.payload.payload);
    const value: string = raw.value;
    const [convId, direction] = value.split(":") as [string, ReplyDirection];

    await deps.pendingReplies.set(ctx.payload.userId, { convId, direction });

    await ctx.spawnModalView({
      callbackId: "anon_reply_modal",
      type: "MODAL",
      title: { type: "plain_text", text: "Anonymous Reply" },
      submit: { type: "plain_text", text: "Send" },
      close: { type: "plain_text", text: "Cancel" },
      notifyOnClose: true,
      blocks: [
        {
          type: "input",
          blockId: "reply_block",
          label: { text: "Your reply", type: "plain_text" },
          element: {
            type: "plain_text_input",
            onAction: "reply_text",
            line_mode: "multiline",
            placeholder: {
              type: "plain_text",
              text: "Type your anonymous reply...",
            },
          },
        },
      ],
    });

    deps.logger.info(
      { eventType: "REPLY_MODAL_OPEN", convId, actorId: ctx.payload.userId, outcome: "ok" },
      "reply modal opened",
    );
  };
}
