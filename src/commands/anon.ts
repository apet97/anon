import { randomUUID } from "crypto";
import type { App } from "pumble-sdk";
import type { AppDeps } from "../deps";
import { parseRecipient } from "../services/parseRecipient";
import { MAX_MESSAGE_LENGTH } from "../services/anonMessage";

type AnonCommand = NonNullable<App["slashCommands"]>[number];

export function makeAnonCommand(deps: AppDeps): AnonCommand {
  return {
    command: "/anon",
    description: "Send an anonymous message",
    usageHint: "@user message or just message",
    handler: async (ctx) => {
      await ctx.ack();

      const senderId = ctx.payload.userId;
      const workspaceId = ctx.payload.workspaceId;
      const text = ctx.payload.text;
      const parsed = parseRecipient(text);

      if (parsed) {
        if (!parsed.message) {
          await ctx.say("Usage: `/anon @user your message`", "ephemeral");
          return;
        }
        await handleDm(deps, ctx, workspaceId, senderId, parsed.userId, parsed.message);
      } else if (ctx.payload.threadRootId) {
        await handleThread(deps, ctx, workspaceId, senderId, text.trim());
      } else {
        await handleChannel(deps, ctx, workspaceId, senderId, text.trim());
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;

async function handleDm(
  deps: AppDeps, ctx: Ctx, workspaceId: string, senderId: string, recipientId: string, message: string,
): Promise<void> {
  if (senderId === recipientId) {
    await ctx.say("You can't send an anonymous message to yourself.", "ephemeral");
    return;
  }
  if (deps.repos.blockedUsers.isBlocked(workspaceId, recipientId)) {
    await ctx.say("This user has opted out of anonymous messages.", "ephemeral");
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    await ctx.say(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`, "ephemeral");
    return;
  }
  if (!deps.rateLimit.checkGlobal(workspaceId, senderId)) {
    await ctx.say("Slow down! You've hit the rate limit. Try again in a minute.", "ephemeral");
    return;
  }
  if (!deps.rateLimit.checkTarget(workspaceId, senderId, recipientId)) {
    await ctx.say("You've reached the limit for messages to this person. Try again later.", "ephemeral");
    return;
  }

  const convId = randomUUID();
  const client = await ctx.getBotClient();
  if (!client) {
    await ctx.say("Bot is not available. Try again later.", "ephemeral");
    return;
  }

  try {
    const sent = await deps.anonMessage.send({
      client, targetId: recipientId, label: "Anonymous message",
      messageText: message, convId, direction: "recipient",
    });
    if (sent) {
      deps.repos.conversations.insert(convId, workspaceId, senderId, recipientId);
      deps.logger.info({ eventType: "SEND", convId, outcome: "ok" }, "anon message delivered");
      deps.auditLog.record({
        eventType: "SEND", workspaceId,
        actorId: senderId, targetId: recipientId, convId, metadata: { outcome: "ok" },
      });
      await ctx.say("Anonymous message sent.", "ephemeral");
    } else {
      deps.logger.warn({ eventType: "SEND", convId, outcome: "no-channel" }, "anon message not delivered");
      deps.auditLog.record({
        eventType: "SEND", workspaceId,
        actorId: senderId, targetId: recipientId, convId, metadata: { outcome: "no-channel" },
      });
      await ctx.say("Could not deliver message. The recipient may not be reachable.", "ephemeral");
    }
  } catch (err) {
    deps.logger.error(
      { eventType: "SEND", convId, outcome: "error", err: (err as Error).message },
      "failed to send anonymous message",
    );
    deps.auditLog.record({
      eventType: "SEND", workspaceId,
      actorId: senderId, targetId: recipientId, convId,
      metadata: { outcome: "send-failed", err: (err as Error).message },
    });
    await ctx.say("Something went wrong. Try again later.", "ephemeral");
  }
}

async function handleChannel(
  deps: AppDeps, ctx: Ctx, workspaceId: string, senderId: string, message: string,
): Promise<void> {
  if (!message) {
    await ctx.say("Usage: `/anon your message` to post anonymously in this channel.", "ephemeral");
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    await ctx.say(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`, "ephemeral");
    return;
  }
  if (!deps.rateLimit.checkGlobal(workspaceId, senderId)) {
    await ctx.say("Slow down! You've hit the rate limit. Try again in a minute.", "ephemeral");
    return;
  }
  if (!deps.rateLimit.checkTarget(workspaceId, senderId, ctx.payload.channelId)) {
    await ctx.say("You've reached the limit for anonymous messages in this channel. Try again later.", "ephemeral");
    return;
  }

  const convId = randomUUID();
  const channelId = ctx.payload.channelId;
  const client = await ctx.getBotClient();
  if (!client) {
    await ctx.say("Bot is not available. Try again later.", "ephemeral");
    return;
  }

  try {
    await deps.anonMessage.sendToChannel({ client, channelId, messageText: message, convId });
    deps.repos.conversations.insertChannel(convId, workspaceId, senderId, channelId, "channel");
    deps.logger.info({ eventType: "SEND_CHANNEL", convId, outcome: "ok" }, "anon channel message posted");
    deps.auditLog.record({
      eventType: "SEND_CHANNEL", workspaceId,
      actorId: senderId, convId, metadata: { outcome: "ok", channelId },
    });
    await ctx.say("Anonymous message posted.", "ephemeral");
  } catch (err) {
    deps.logger.error(
      { eventType: "SEND_CHANNEL", convId, outcome: "error", err: (err as Error).message },
      "failed to post anonymous channel message",
    );
    deps.auditLog.record({
      eventType: "SEND_CHANNEL", workspaceId,
      actorId: senderId, convId, metadata: { outcome: "send-failed", err: (err as Error).message },
    });
    await ctx.say("Something went wrong. Try again later.", "ephemeral");
  }
}

async function handleThread(
  deps: AppDeps, ctx: Ctx, workspaceId: string, senderId: string, message: string,
): Promise<void> {
  if (!message) {
    await ctx.say("Usage: `/anon your message` to reply anonymously in this thread.", "ephemeral");
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    await ctx.say(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`, "ephemeral");
    return;
  }
  if (!deps.rateLimit.checkGlobal(workspaceId, senderId)) {
    await ctx.say("Slow down! You've hit the rate limit. Try again in a minute.", "ephemeral");
    return;
  }
  if (!deps.rateLimit.checkTarget(workspaceId, senderId, ctx.payload.channelId)) {
    await ctx.say("You've reached the limit for anonymous messages in this channel. Try again later.", "ephemeral");
    return;
  }

  const convId = randomUUID();
  const channelId = ctx.payload.channelId;
  const threadRootId = ctx.payload.threadRootId!;
  const client = await ctx.getBotClient();
  if (!client) {
    await ctx.say("Bot is not available. Try again later.", "ephemeral");
    return;
  }

  try {
    await deps.anonMessage.replyInThread({ client, threadRootId, channelId, messageText: message, convId });
    deps.repos.conversations.insertChannel(convId, workspaceId, senderId, channelId, "thread", threadRootId);
    deps.logger.info({ eventType: "SEND_THREAD", convId, outcome: "ok" }, "anon thread reply posted");
    deps.auditLog.record({
      eventType: "SEND_THREAD", workspaceId,
      actorId: senderId, convId, metadata: { outcome: "ok", channelId, threadRootId },
    });
    await ctx.say("Anonymous reply posted in thread.", "ephemeral");
  } catch (err) {
    deps.logger.error(
      { eventType: "SEND_THREAD", convId, outcome: "error", err: (err as Error).message },
      "failed to post anonymous thread reply",
    );
    deps.auditLog.record({
      eventType: "SEND_THREAD", workspaceId,
      actorId: senderId, convId, metadata: { outcome: "send-failed", err: (err as Error).message },
    });
    await ctx.say("Something went wrong. Try again later.", "ephemeral");
  }
}
