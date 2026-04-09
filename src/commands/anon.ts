import { randomUUID } from "crypto";
import type { App } from "pumble-sdk";
import type { AppDeps } from "../deps";
import { parseRecipient } from "../services/parseRecipient";
import { MAX_MESSAGE_LENGTH } from "../services/anonMessage";

/**
 * `/anon @user message` — send an anonymous message.
 *
 * Ack rules: acked immediately per Pumble's 3-second contract; all
 * validation, DB writes, and the downstream Pumble API call happen
 * after the ack.
 */
type AnonCommand = NonNullable<App["slashCommands"]>[number];

export function makeAnonCommand(deps: AppDeps): AnonCommand {
  return {
    command: "/anon",
    description: "Send an anonymous message to someone",
    usageHint: "/anon @user your message",
    handler: async (ctx) => {
      await ctx.ack();

      const parsed = parseRecipient(ctx.payload.text);
      if (!parsed || !parsed.message) {
        await ctx.say("Usage: `/anon @user your message`", "ephemeral");
        return;
      }

      const senderId = ctx.payload.userId;
      const recipientId = parsed.userId;

      if (senderId === recipientId) {
        await ctx.say("You can't send an anonymous message to yourself.", "ephemeral");
        return;
      }

      if (deps.repos.blockedUsers.isBlocked(recipientId)) {
        await ctx.say("This user has opted out of anonymous messages.", "ephemeral");
        return;
      }

      if (parsed.message.length > MAX_MESSAGE_LENGTH) {
        await ctx.say(
          `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`,
          "ephemeral",
        );
        return;
      }

      if (!deps.rateLimit.checkGlobal(senderId)) {
        await ctx.say(
          "Slow down! You can send up to 5 anonymous messages per minute.",
          "ephemeral",
        );
        return;
      }

      if (!deps.rateLimit.checkTarget(senderId, recipientId)) {
        await ctx.say(
          "You've reached the limit for messages to this person. Try again later.",
          "ephemeral",
        );
        return;
      }

      const convId = randomUUID();
      deps.repos.conversations.insert(convId, senderId, recipientId);

      const client = await ctx.getBotClient();
      if (!client) {
        await ctx.say("Bot is not available. Try again later.", "ephemeral");
        return;
      }

      try {
        const sent = await deps.anonMessage.send({
          client,
          targetId: recipientId,
          label: "Anonymous message",
          messageText: parsed.message,
          convId,
          direction: "recipient",
        });
        if (sent) {
          deps.logger.info(
            { eventType: "SEND", convId, outcome: "ok" },
            "anon message delivered",
          );
          deps.auditLog.record({
            eventType: "SEND",
            workspaceId: ctx.payload.workspaceId,
            actorId: senderId,
            targetId: recipientId,
            convId,
            metadata: { outcome: "ok" },
          });
          await ctx.say("Anonymous message sent.", "ephemeral");
        } else {
          deps.logger.warn(
            { eventType: "SEND", convId, outcome: "no-channel" },
            "anon message not delivered",
          );
          deps.auditLog.record({
            eventType: "SEND",
            workspaceId: ctx.payload.workspaceId,
            actorId: senderId,
            targetId: recipientId,
            convId,
            metadata: { outcome: "no-channel" },
          });
          await ctx.say(
            "Could not deliver message. The recipient may not be reachable.",
            "ephemeral",
          );
        }
      } catch (err) {
        deps.logger.error(
          { eventType: "SEND", convId, outcome: "error", err: (err as Error).message },
          "failed to send anonymous message",
        );
        await ctx.say("Something went wrong. Try again later.", "ephemeral");
      }
    },
  };
}
