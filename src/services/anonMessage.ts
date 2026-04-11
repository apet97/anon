import type { ApiClient } from "pumble-sdk";
import type { ConversationsRepo } from "../db/repos/conversationsRepo";
import type { Logger } from "../logger";
import type { ReplyDirection } from "./pendingReplies";

export const MAX_MESSAGE_LENGTH = 2000;

function buildAnonBlocks(label: string, messageText: string, convId: string, direction: string) {
  return [
    {
      type: "rich_text" as const,
      elements: [
        {
          type: "rich_text_section" as const,
          elements: [
            { type: "text" as const, text: label, style: { bold: true } },
          ],
        },
        {
          type: "rich_text_quote" as const,
          elements: [
            { type: "text" as const, text: messageText },
          ],
        },
      ],
    },
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          onAction: "reply_anon",
          value: `${convId}:${direction}`,
          text: { type: "plain_text" as const, text: "Reply Anonymously" },
          style: "primary" as const,
        },
        {
          type: "button" as const,
          onAction: "report_anon",
          value: `${convId}:${direction}`,
          text: { type: "plain_text" as const, text: "Report" },
          style: "danger" as const,
        },
      ],
    },
  ];
}

export interface SendAnonMessageArgs {
  client: ApiClient;
  targetId: string;
  label: string;
  messageText: string;
  convId: string;
  direction: ReplyDirection;
}

export interface SendToChannelArgs {
  client: ApiClient;
  channelId: string;
  messageText: string;
  convId: string;
}

export interface ReplyInThreadArgs {
  client: ApiClient;
  threadRootId: string;
  channelId: string;
  messageText: string;
  convId: string;
}

export interface AnonMessageService {
  send(args: SendAnonMessageArgs): Promise<boolean>;
  sendToChannel(args: SendToChannelArgs): Promise<boolean>;
  replyInThread(args: ReplyInThreadArgs): Promise<boolean>;
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

      await client.v1.messages.postMessageToChannel(channelId, {
        text: `${label}: ${messageText}`,
        blocks: buildAnonBlocks(label, messageText, convId, direction),
      });
      deps.conversations.updateLastMessage(convId, messageText);
      return true;
    },

    async sendToChannel({ client, channelId, messageText, convId }) {
      const msg = await client.v1.messages.postMessageToChannel(channelId, {
        text: `Anonymous: ${messageText}`,
        blocks: buildAnonBlocks("Anonymous", messageText, convId, "recipient"),
      });
      deps.conversations.updateLastMessage(convId, messageText);
      if (msg?.id) {
        deps.conversations.updateThreadRootId(convId, msg.id);
      }
      return true;
    },

    async replyInThread({ client, threadRootId, channelId, messageText, convId }) {
      await client.v1.messages.reply(threadRootId, channelId, {
        text: `Anonymous: ${messageText}`,
        blocks: buildAnonBlocks("Anonymous", messageText, convId, "recipient"),
      });
      deps.conversations.updateLastMessage(convId, messageText);
      return true;
    },
  };
}
