import { randomUUID } from "crypto";
import type { ApiClient, App } from "pumble-sdk";
import type { AppDeps } from "../deps";
import { parseRecipient } from "../services/parseRecipient";
import { MAX_MESSAGE_LENGTH } from "../services/anonMessage";

type AnonCommand = NonNullable<App["slashCommands"]>[number];
type SlashCtx = Parameters<NonNullable<AnonCommand["handler"]>>[0];

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
        await handleThread(
          deps, ctx, workspaceId, senderId, ctx.payload.threadRootId, text.trim(),
        );
      } else {
        await handleChannel(deps, ctx, workspaceId, senderId, text.trim());
      }
    },
  };
}

/**
 * Shared preflight for all three send flows. Runs message-length,
 * global rate-limit, target rate-limit checks, and fetches the bot
 * client. On any failure it writes an ephemeral error message to the
 * user and returns null. The caller then early-returns without any
 * further handling.
 */
async function preflight(
  deps: AppDeps,
  ctx: SlashCtx,
  workspaceId: string,
  senderId: string,
  message: string,
  targetRateLimitKey: string,
  targetLimitEphemeral: string,
): Promise<ApiClient | null> {
  if (message.length > MAX_MESSAGE_LENGTH) {
    await ctx.say(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`, "ephemeral");
    return null;
  }
  if (!deps.rateLimit.checkGlobal(workspaceId, senderId)) {
    await ctx.say("Slow down! You've hit the rate limit. Try again in a minute.", "ephemeral");
    return null;
  }
  if (!deps.rateLimit.checkTarget(workspaceId, senderId, targetRateLimitKey)) {
    await ctx.say(targetLimitEphemeral, "ephemeral");
    return null;
  }
  const client = await ctx.getBotClient();
  if (!client) {
    await ctx.say("Bot is not available. Try again later.", "ephemeral");
    return null;
  }
  return client;
}

/**
 * Shared error-path logging for all three send flows. Logs the error
 * with structured context, records an audit entry with the same
 * outcome metadata, and surfaces an ephemeral message to the user.
 */
async function reportSendError(
  deps: AppDeps,
  ctx: SlashCtx,
  params: {
    eventType: string;
    convId: string;
    workspaceId: string;
    senderId: string;
    targetId?: string;
    extraMetadata?: Record<string, unknown>;
    logMessage: string;
    err: unknown;
  },
): Promise<void> {
  const errMsg = (params.err as Error).message;
  deps.logger.error(
    { eventType: params.eventType, convId: params.convId, outcome: "error", err: errMsg },
    params.logMessage,
  );
  deps.auditLog.record({
    eventType: params.eventType,
    workspaceId: params.workspaceId,
    actorId: params.senderId,
    ...(params.targetId !== undefined ? { targetId: params.targetId } : {}),
    convId: params.convId,
    metadata: { outcome: "send-failed", ...params.extraMetadata, err: errMsg },
  });
  await ctx.say("Something went wrong. Try again later.", "ephemeral");
}

async function handleDm(
  deps: AppDeps,
  ctx: SlashCtx,
  workspaceId: string,
  senderId: string,
  recipientId: string,
  message: string,
): Promise<void> {
  if (senderId === recipientId) {
    await ctx.say("You can't send an anonymous message to yourself.", "ephemeral");
    return;
  }
  if (deps.repos.blockedUsers.isBlocked(workspaceId, recipientId)) {
    await ctx.say("This user has opted out of anonymous messages.", "ephemeral");
    return;
  }

  const client = await preflight(
    deps, ctx, workspaceId, senderId, message, recipientId,
    "You've reached the limit for messages to this person. Try again later.",
  );
  if (!client) return;

  const convId = randomUUID();
  // C-1 ordering: write the conversation row (with last_message) BEFORE the
  // Pumble call so the admin Report flow has real content. INSERT OR IGNORE
  // keeps retries on the same convId idempotent; orphan rows on Pumble
  // failure carry the sender's identity for audit review.
  deps.repos.conversations.insert(convId, workspaceId, senderId, recipientId, message);
  try {
    const sent = await deps.anonMessage.send({
      client, targetId: recipientId, label: "Anonymous message",
      messageText: message, convId, direction: "recipient",
    });
    if (sent) {
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
    await reportSendError(deps, ctx, {
      eventType: "SEND", convId, workspaceId, senderId, targetId: recipientId,
      logMessage: "failed to send anonymous message", err,
    });
  }
}

async function handleChannel(
  deps: AppDeps,
  ctx: SlashCtx,
  workspaceId: string,
  senderId: string,
  message: string,
): Promise<void> {
  if (!message) {
    await ctx.say("Usage: `/anon your message` to post anonymously in this channel.", "ephemeral");
    return;
  }

  const channelId = ctx.payload.channelId;
  const client = await preflight(
    deps, ctx, workspaceId, senderId, message, channelId,
    "You've reached the limit for anonymous messages in this channel. Try again later.",
  );
  if (!client) return;

  const convId = randomUUID();
  // C-1/C-2 ordering: insert the row (with last_message) first; capture the
  // Pumble messageId from sendToChannel and persist it as thread_root_id so
  // subsequent `Reply Anonymously` actions can thread onto the real message.
  deps.repos.conversations.insertChannel(convId, workspaceId, senderId, channelId, "channel", message);
  try {
    const messageId = await deps.anonMessage.sendToChannel({ client, channelId, messageText: message, convId });
    if (messageId) {
      deps.repos.conversations.updateThreadRootId(convId, messageId);
    }
    deps.logger.info({ eventType: "SEND_CHANNEL", convId, outcome: "ok" }, "anon channel message posted");
    deps.auditLog.record({
      eventType: "SEND_CHANNEL", workspaceId,
      actorId: senderId, convId, metadata: { outcome: "ok", channelId },
    });
    await ctx.say("Anonymous message posted.", "ephemeral");
  } catch (err) {
    await reportSendError(deps, ctx, {
      eventType: "SEND_CHANNEL", convId, workspaceId, senderId,
      extraMetadata: { channelId },
      logMessage: "failed to post anonymous channel message", err,
    });
  }
}

async function handleThread(
  deps: AppDeps,
  ctx: SlashCtx,
  workspaceId: string,
  senderId: string,
  threadRootId: string,
  message: string,
): Promise<void> {
  if (!message) {
    await ctx.say("Usage: `/anon your message` to reply anonymously in this thread.", "ephemeral");
    return;
  }

  const channelId = ctx.payload.channelId;
  const client = await preflight(
    deps, ctx, workspaceId, senderId, message, channelId,
    "You've reached the limit for anonymous messages in this channel. Try again later.",
  );
  if (!client) return;

  const convId = randomUUID();
  // C-1 ordering: row exists before the Pumble call. thread_root_id comes
  // straight from ctx.payload (not Pumble's response) so no follow-up UPDATE
  // is required.
  deps.repos.conversations.insertChannel(convId, workspaceId, senderId, channelId, "thread", message, threadRootId);
  try {
    await deps.anonMessage.replyInThread({ client, threadRootId, channelId, messageText: message, convId });
    deps.logger.info({ eventType: "SEND_THREAD", convId, outcome: "ok" }, "anon thread reply posted");
    deps.auditLog.record({
      eventType: "SEND_THREAD", workspaceId,
      actorId: senderId, convId, metadata: { outcome: "ok", channelId, threadRootId },
    });
    await ctx.say("Anonymous reply posted in thread.", "ephemeral");
  } catch (err) {
    await reportSendError(deps, ctx, {
      eventType: "SEND_THREAD", convId, workspaceId, senderId,
      extraMetadata: { channelId, threadRootId },
      logMessage: "failed to post anonymous thread reply", err,
    });
  }
}
