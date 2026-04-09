import type { BlockInteractionContext } from "pumble-sdk/lib/core/types/contexts";
import type { AppDeps } from "../deps";

type MessageBlockInteractionCtx = BlockInteractionContext<"MESSAGE">;

/**
 * `report_anon` button handler — posts an abuse report to the private
 * reports channel with the anonymous sender's real identity exposed.
 *
 * Ack rule: ack after posting the report. There is no modal here, so
 * the ack is the only HTTP response. Errors from the report post are
 * logged and swallowed so the user still gets an HTTP 200.
 *
 * The message preview is truncated to 200 chars before being sent to
 * the report channel; we never log the preview or the full body.
 */
export type ReportAnonHandler = (ctx: MessageBlockInteractionCtx) => Promise<void>;

const PREVIEW_MAX_CHARS = 200;

export function makeReportAnonHandler(deps: AppDeps): ReportAnonHandler {
  return async (ctx) => {
    const raw = JSON.parse(ctx.payload.payload);
    const value: string = raw.value;
    const [convId, direction] = value.split(":");

    const conv = deps.repos.conversations.get(convId);
    if (!conv) {
      deps.logger.warn(
        { eventType: "REPORT", convId, outcome: "conv-not-found" },
        "report attempted for unknown conversation",
      );
      await ctx.ack();
      return;
    }

    const anonSenderId =
      direction === "recipient" ? conv.sender_id : conv.recipient_id;
    const reporterId = ctx.payload.userId;

    const client = await ctx.getBotClient();
    if (!client) {
      deps.logger.error(
        { eventType: "REPORT", convId, outcome: "no-bot-client" },
        "report failed: bot client unavailable",
      );
      await ctx.ack();
      return;
    }

    const reportChannelId = await deps.reportChannel.getOrCreate(client);
    if (!reportChannelId) {
      await ctx.ack();
      return;
    }

    const messagePreview = conv.last_message
      ? conv.last_message.length > PREVIEW_MAX_CHARS
        ? conv.last_message.slice(0, PREVIEW_MAX_CHARS) + "..."
        : conv.last_message
      : "(message not available)";

    try {
      await client.v1.messages.postMessageToChannel(reportChannelId, {
        text: `Abuse report: Sender <@${anonSenderId}>, reported by <@${reporterId}>`,
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "Abuse Report", style: { bold: true } },
                ],
              },
              {
                type: "rich_text_list",
                style: "bullet",
                indent: 0,
                elements: [
                  {
                    type: "rich_text_section",
                    elements: [
                      { type: "text", text: "Anonymous sender: " },
                      { type: "user", user_id: anonSenderId },
                    ],
                  },
                  {
                    type: "rich_text_section",
                    elements: [
                      { type: "text", text: "Reported by: " },
                      { type: "user", user_id: reporterId },
                    ],
                  },
                  {
                    type: "rich_text_section",
                    elements: [
                      { type: "text", text: `Conversation: ${convId}` },
                    ],
                  },
                ],
              },
              {
                type: "rich_text_quote",
                elements: [
                  { type: "text", text: messagePreview },
                ],
              },
            ],
          },
        ],
      });
      deps.logger.info(
        {
          eventType: "REPORT",
          convId,
          actorId: reporterId,
          targetId: anonSenderId,
          outcome: "ok",
        },
        "abuse report posted",
      );
    } catch (err) {
      deps.logger.error(
        {
          eventType: "REPORT",
          convId,
          outcome: "post-failed",
          err: (err as Error).message,
        },
        "failed to post report",
      );
    }

    // Ack after posting report (spawnModalView is not used here).
    await ctx.ack();
  };
}
