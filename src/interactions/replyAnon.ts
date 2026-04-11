import type { BlockInteractionContext } from "pumble-sdk/lib/core/types/contexts";
import type { AppDeps } from "../deps";
import type { ReplyDirection } from "../services/pendingReplies";

type MessageBlockInteractionCtx = BlockInteractionContext<"MESSAGE">;

const VALID_DIRECTIONS: ReadonlySet<string> = new Set(["recipient", "sender"]);

/**
 * `reply_anon` button handler — opens the anonymous reply modal.
 *
 * Ack rule: **do not** call `ctx.ack()` here on the happy path. The
 * Pumble SDK sends the modal as the HTTP response, and calling ack
 * first would silently drop the modal (see pumble-sdk-gotchas).
 *
 * On error (unparseable/invalid payload) we call `ctx.ack()` instead
 * to stop the SDK retry loop — no modal is opened in that case.
 *
 * Modal textarea uses `line_mode: "multiline"` (the SDK 1.1.1
 * property); the legacy `multiline: true` is silently ignored.
 */
export type ReplyAnonHandler = (ctx: MessageBlockInteractionCtx) => Promise<void>;

export function makeReplyAnonHandler(deps: AppDeps): ReplyAnonHandler {
  return async (ctx) => {
    let raw: { value?: string };
    try {
      raw = JSON.parse(ctx.payload.payload) as { value?: string };
    } catch {
      deps.logger.warn(
        { actorId: ctx.payload.userId, outcome: "bad-payload" },
        "reply_anon: unparseable payload",
      );
      await ctx.ack();
      return;
    }

    const value = raw.value ?? "";
    const parts = value.split(":");
    const convId = parts[0];
    const direction = parts[1];
    if (!convId || !direction || !VALID_DIRECTIONS.has(direction)) {
      deps.logger.warn(
        { actorId: ctx.payload.userId, value, outcome: "bad-payload" },
        "reply_anon: invalid payload value",
      );
      await ctx.ack();
      return;
    }

    await deps.pendingReplies.set(ctx.payload.workspaceId, ctx.payload.userId, {
      convId,
      direction: direction as ReplyDirection,
    });

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
