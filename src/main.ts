import { App, JsonFileTokenStore, start, ApiClient } from "pumble-sdk";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import path from "path";

// --- SQLite setup ---
const db = new Database(path.join(__dirname, "..", "conversations.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    last_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS blocked_users (
    user_id TEXT PRIMARY KEY,
    blocked_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS rate_limits (
    user_id TEXT PRIMARY KEY,
    msg_count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS target_limits (
    sender_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    msg_count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (sender_id, target_id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);
// Migration: add last_message column if upgrading from older schema
try { db.exec("ALTER TABLE conversations ADD COLUMN last_message TEXT"); } catch {}

// --- Prepared statements ---
const insertConv = db.prepare("INSERT INTO conversations (id, sender_id, recipient_id) VALUES (?, ?, ?)");
const getConv = db.prepare("SELECT sender_id, recipient_id, last_message FROM conversations WHERE id = ?");
const updateLastMessage = db.prepare("UPDATE conversations SET last_message = ? WHERE id = ?");
const isBlocked = db.prepare("SELECT 1 FROM blocked_users WHERE user_id = ?");
const blockUser = db.prepare("INSERT OR IGNORE INTO blocked_users (user_id) VALUES (?)");
const unblockUser = db.prepare("DELETE FROM blocked_users WHERE user_id = ?");
const getRateLimit = db.prepare("SELECT msg_count, window_start FROM rate_limits WHERE user_id = ?");
const upsertRateLimit = db.prepare("INSERT INTO rate_limits (user_id, msg_count, window_start) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET msg_count = 1, window_start = ?");
const incrementRateLimit = db.prepare("UPDATE rate_limits SET msg_count = msg_count + 1 WHERE user_id = ?");
const getTargetLimit = db.prepare("SELECT msg_count, window_start FROM target_limits WHERE sender_id = ? AND target_id = ?");
const upsertTargetLimit = db.prepare("INSERT INTO target_limits (sender_id, target_id, msg_count, window_start) VALUES (?, ?, 1, ?) ON CONFLICT(sender_id, target_id) DO UPDATE SET msg_count = 1, window_start = ?");
const incrementTargetLimit = db.prepare("UPDATE target_limits SET msg_count = msg_count + 1 WHERE sender_id = ? AND target_id = ?");
const getConfig = db.prepare("SELECT value FROM config WHERE key = ?");
const setConfig = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");

// --- Constants ---
const RATE_LIMIT = 5;
const RATE_WINDOW_SECS = 60;
const TARGET_RATE_LIMIT = 2;
const TARGET_RATE_WINDOW_SECS = 3600; // 1 hour
const MAX_MESSAGE_LENGTH = 2000;

// --- Rate limiting ---
function checkRateLimit(userId: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const row = getRateLimit.get(userId) as { msg_count: number; window_start: number } | undefined;

  if (!row || now - row.window_start > RATE_WINDOW_SECS) {
    upsertRateLimit.run(userId, now, now);
    return true;
  }

  if (row.msg_count >= RATE_LIMIT) return false;

  incrementRateLimit.run(userId);
  return true;
}

function checkTargetRateLimit(senderId: string, targetId: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const row = getTargetLimit.get(senderId, targetId) as { msg_count: number; window_start: number } | undefined;

  if (!row || now - row.window_start > TARGET_RATE_WINDOW_SECS) {
    upsertTargetLimit.run(senderId, targetId, now, now);
    return true;
  }

  if (row.msg_count >= TARGET_RATE_LIMIT) return false;

  incrementTargetLimit.run(senderId, targetId);
  return true;
}

// --- Pending replies (in-memory, ephemeral to active modal sessions) ---
const pendingReplies = new Map<string, { convId: string; direction: string }>();

// --- Helpers ---
function parseRecipient(text: string): { userId: string; message: string } | null {
  const match = text.match(/^<<@([^>]+)>>\s*([\s\S]*)/);
  if (!match) return null;
  return { userId: match[1], message: match[2].trim() };
}

async function sendAnonMessage(
  client: ApiClient,
  targetId: string,
  label: string,
  messageText: string,
  convId: string,
  direction: string,
) {
  const dmChannel = await client.v1.channels.getDirectChannel([targetId]);
  const channelId = dmChannel?.channel?.id;
  if (!channelId) return false;

  updateLastMessage.run(messageText, convId);

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
}

// --- Report channel ---
async function getOrCreateReportChannel(client: ApiClient): Promise<string | null> {
  const cached = getConfig.get("report_channel_id") as { value: string } | undefined;
  if (cached) {
    return cached.value;
  }

  try {
    const channels = await client.v1.channels.listChannels(["PRIVATE"]);
    const existing = channels.find(c => c.channel.name === "abot-reports");
    if (existing) {
      setConfig.run("report_channel_id", existing.channel.id);
      return existing.channel.id;
    }

    const newChannel = await client.v1.channels.createChannel({
      name: "abot-reports",
      type: "PRIVATE",
      description: "Anonymous message abuse reports from Abot",
    });
    const channelId = newChannel.channel.id;
    setConfig.run("report_channel_id", channelId);

    const users = await client.v1.users.listWorkspaceUsers();
    const adminIds = users
      .filter(u => ["OWNER", "ADMIN"].includes(u.role))
      .map(u => u.id);
    if (adminIds.length > 0) {
      await client.v1.channels.addUsersToChannel(channelId, { userIds: adminIds });
    }

    await client.v1.messages.postMessageToChannel(channelId, {
      text: "This channel receives anonymous message abuse reports. Each report includes the sender's real identity.",
    });

    return channelId;
  } catch (err) {
    console.error("Failed to set up report channel:", err);
    return null;
  }
}

// --- Token store ---
function createTokenStore() {
  if (process.env.MONGODB_URI) {
    try {
      const { MongoClient } = require("mongodb");
      const { MongoDbTokenStore } = require("pumble-sdk");
      const client = new MongoClient(process.env.MONGODB_URI);
      return new MongoDbTokenStore(client, "abot", "tokens");
    } catch {
      console.warn("mongodb not installed, falling back to JsonFileTokenStore");
    }
  }
  return new JsonFileTokenStore("tokens.json");
}

// --- App ---
const addon: App = {
  slashCommands: [
    {
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

        if (isBlocked.get(recipientId)) {
          await ctx.say("This user has opted out of anonymous messages.", "ephemeral");
          return;
        }

        if (parsed.message.length > MAX_MESSAGE_LENGTH) {
          await ctx.say(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`, "ephemeral");
          return;
        }

        if (!checkRateLimit(senderId)) {
          await ctx.say("Slow down! You can send up to 5 anonymous messages per minute.", "ephemeral");
          return;
        }

        if (!checkTargetRateLimit(senderId, recipientId)) {
          await ctx.say("You've reached the limit for messages to this person. Try again later.", "ephemeral");
          return;
        }

        const convId = randomUUID();
        insertConv.run(convId, senderId, recipientId);

        const client = await ctx.getBotClient();
        if (!client) {
          await ctx.say("Bot is not available. Try again later.", "ephemeral");
          return;
        }

        try {
          const sent = await sendAnonMessage(client, recipientId, "Anonymous message", parsed.message, convId, "recipient");
          if (sent) {
            await ctx.say("Anonymous message sent.", "ephemeral");
          } else {
            await ctx.say("Could not deliver message. The recipient may not be reachable.", "ephemeral");
          }
        } catch (err) {
          console.error("Failed to send anonymous message:", err);
          await ctx.say("Something went wrong. Try again later.", "ephemeral");
        }
      },
    },
    {
      command: "/anon-block",
      description: "Stop receiving anonymous messages",
      usageHint: "/anon-block",
      handler: async (ctx) => {
        await ctx.ack();
        blockUser.run(ctx.payload.userId);
        await ctx.say("You will no longer receive anonymous messages. Use `/anon-unblock` to opt back in.", "ephemeral");
      },
    },
    {
      command: "/anon-unblock",
      description: "Resume receiving anonymous messages",
      usageHint: "/anon-unblock",
      handler: async (ctx) => {
        await ctx.ack();
        unblockUser.run(ctx.payload.userId);
        await ctx.say("You can now receive anonymous messages again.", "ephemeral");
      },
    },
  ],

  blockInteraction: {
    interactions: [
      {
        sourceType: "MESSAGE",
        handlers: {
          reply_anon: async (ctx) => {
            const raw = JSON.parse(ctx.payload.payload);
            const value: string = raw.value;
            const [convId, direction] = value.split(":");

            pendingReplies.set(ctx.payload.userId, { convId, direction });

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
                    placeholder: { type: "plain_text", text: "Type your anonymous reply..." },
                  },
                },
              ],
            });
          },

          report_anon: async (ctx) => {
            const raw = JSON.parse(ctx.payload.payload);
            const value: string = raw.value;
            const [convId, direction] = value.split(":");

            const conv = getConv.get(convId) as { sender_id: string; recipient_id: string; last_message: string | null } | undefined;
            if (!conv) {
              await ctx.ack();
              return;
            }

            // The anonymous sender of this message
            const anonSenderId = direction === "recipient" ? conv.sender_id : conv.recipient_id;
            const reporterId = ctx.payload.userId;

            const client = await ctx.getBotClient();
            if (!client) {
              await ctx.ack();
              return;
            }

            const reportChannelId = await getOrCreateReportChannel(client);
            if (!reportChannelId) {
              await ctx.ack();
              return;
            }

            const messagePreview = conv.last_message
              ? conv.last_message.length > 200 ? conv.last_message.slice(0, 200) + "..." : conv.last_message
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
            } catch (err) {
              console.error("Failed to post report:", err);
            }

            // Ack after posting report (spawnModalView not used here)
            await ctx.ack();
          },
        },
      },
    ],
  },

  viewAction: {
    onSubmit: {
      anon_reply_modal: async (ctx) => {
        await ctx.ack();

        const userId = ctx.payload.userId;
        const pending = pendingReplies.get(userId);
        pendingReplies.delete(userId);

        if (!pending) {
          console.error("No pending reply for user:", userId);
          return;
        }

        const state = ctx.payload.view.state;
        const replyText = (state?.values as any)?.reply_block?.reply_text?.value as string | undefined;
        if (!replyText) return;

        if (replyText.length > MAX_MESSAGE_LENGTH) return;

        const conv = getConv.get(pending.convId) as { sender_id: string; recipient_id: string } | undefined;
        if (!conv) {
          console.error("Conversation not found:", pending.convId);
          return;
        }

        const targetId = pending.direction === "recipient" ? conv.sender_id : conv.recipient_id;
        const newDirection = pending.direction === "recipient" ? "sender" : "recipient";

        const client = await ctx.getBotClient();
        if (!client) return;

        try {
          await sendAnonMessage(client, targetId, "Anonymous reply", replyText, pending.convId, newDirection);
        } catch (err) {
          console.error("Failed to send anonymous reply:", err);
        }
      },
    },
    onClose: {
      anon_reply_modal: async (ctx) => {
        pendingReplies.delete(ctx.payload.userId);
      },
    },
  },

  events: [
    {
      name: "APP_UNAUTHORIZED",
      handler: async (ctx) => {
        console.log("User unauthorized:", ctx.payload.body);
      },
    },
    {
      name: "APP_UNINSTALLED",
      handler: async (ctx) => {
        console.log("App uninstalled from:", ctx.payload.workspaceId);
      },
    },
  ],

  eventsPath: "/hook",
  tokenStore: createTokenStore(),
};

start(addon);
