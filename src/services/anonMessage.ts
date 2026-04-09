import type { ApiClient } from "pumble-sdk";
import type { ConversationsRepo } from "../db/repos/conversationsRepo";
import type { Logger } from "../logger";
import type { ReplyDirection } from "./pendingReplies";

/**
 * Posts an anonymous message (initial or reply) to the target user's
 * DM channel with the Reply + Report action buttons attached.
 *
 * Message format is preserved verbatim from the 0.0.29 prototype to
 * keep user-visible behaviour stable through the refactor:
 * - rich_text block with a bold label and a quoted message body.
 * - actions block with a primary "Reply Anonymously" button and a
 *   danger "Report" button. Both buttons carry `${convId}:${direction}`
 *   as their value so the interaction handlers can route them back
 *   to the right conversation without any server-side state.
 */

export const MAX_MESSAGE_LENGTH = 2000;

export interface SendAnonMessageArgs {
  client: ApiClient;
  targetId: string;
  label: string;
  messageText: string;
  convId: string;
  direction: ReplyDirection;
}

export interface AnonMessageService {
  send(args: SendAnonMessageArgs): Promise<boolean>;
}

export interface AnonMessageDeps {
  conversations: ConversationsRepo;
  logger: Logger;
}

export function makeAnonMessageService(deps: AnonMessageDeps): AnonMessageService {
  return {
    async send({ client, targetId, label, messageText, convId, direction }) {
      const dmChannel = await client.v1.channels.getDirectChannel([targetId]);
      const channelId = dmChannel?.channel?.id;
      if (!channelId) {
        deps.logger.warn({ convId, targetId, outcome: "no-channel" }, "anon message: no DM channel");
        return false;
      }

      deps.conversations.updateLastMessage(convId, messageText);

      await client.v1.messages.postMessageToChannel(channelId, {
        text: `${label}: ${messageText}`,
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: label, style: { bold: true } },
                ],
              },
              {
                type: "rich_text_quote",
                elements: [
                  { type: "text", text: messageText },
                ],
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                onAction: "reply_anon",
                value: `${convId}:${direction}`,
                text: { type: "plain_text", text: "Reply Anonymously" },
                style: "primary",
              },
              {
                type: "button",
                onAction: "report_anon",
                value: `${convId}:${direction}`,
                text: { type: "plain_text", text: "Report" },
                style: "danger",
              },
            ],
          },
        ],
      });
      return true;
    },
  };
}
