import { describe, it, expect } from "vitest";
import { makeAnonCommand } from "../../src/commands/anon";
import { RATE_LIMIT, TARGET_RATE_LIMIT } from "../../src/services/rateLimit";
import { makeTestDeps } from "../helpers/deps";
import { makeSlashCommandCtx } from "../helpers/ctx";
import { makeFakePumbleClient } from "../helpers/pumbleClient";

describe("/anon command", () => {
  it("sends an anonymous message on the happy path and inserts a conversation row", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient({ dmChannelId: "dm-1" });
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>> be nice",
      botClient: client,
    });

    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    expect(client.posts).toHaveLength(1);
    expect(client.posts[0]!.body.text).toBe("Anonymous message: be nice");
    expect(ctx.sayCalls.at(-1)).toEqual({
      text: "Anonymous message sent.",
      visibility: "ephemeral",
    });
  });

  it("rejects missing message text", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>>",
    });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
    expect(ctx.sayCalls[0]!.text).toMatch(/Usage: `\/anon/);
  });

  it("rejects self-message", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "u1",
      text: "<<@u1>> hello me",
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0]!.text).toMatch(/yourself/);
  });

  it("rejects messages to a blocked recipient", async () => {
    const deps = makeTestDeps();
    deps.repos.blockedUsers.block("recipient-1");
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>> hi",
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0]!.text).toMatch(/opted out/);
  });

  it("rejects messages longer than 2000 characters", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonCommand(deps).handler;
    const longMsg = "x".repeat(2001);
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: `<<@recipient-1>> ${longMsg}`,
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0]!.text).toMatch(/too long/i);
  });

  it("enforces the global rate limit", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      const ctx = makeSlashCommandCtx({
        userId: "sender-1",
        text: `<<@r${i}>> hi`,
        botClient: client,
      });
      await handler(ctx as any);
    }
    // The 6th should trip the global limit
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@r99>> hi",
      botClient: client,
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0]!.text).toMatch(/Slow down/);
  });

  it("enforces the per-target rate limit", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    for (let i = 0; i < TARGET_RATE_LIMIT; i += 1) {
      const ctx = makeSlashCommandCtx({
        userId: "sender-1",
        text: "<<@recipient-1>> hi",
        botClient: client,
      });
      await handler(ctx as any);
    }
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>> hi again",
      botClient: client,
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0]!.text).toMatch(/limit for messages to this person/);
  });

  it("reports bot-unavailable cleanly", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>> hi",
      botClient: undefined,
    });
    await handler(ctx as any);
    expect(ctx.sayCalls.at(-1)?.text).toMatch(/Bot is not available/);
  });

  it("posts anonymously to a channel when text has no @mention", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "hello channel",
      channelId: "ch-general",
      botClient: client,
    });
    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    expect(client.channelPosts).toHaveLength(1);
    expect(client.channelPosts[0]!.channelId).toBe("ch-general");
    expect(client.channelPosts[0]!.body.text).toBe("Anonymous: hello channel");
    expect(ctx.sayCalls.at(-1)?.text).toMatch(/Anonymous message posted/);
    const conv = deps.repos.conversations.get(client.channelPosts[0]!.body.blocks[1].elements[0].value.split(":")[0]!);
    expect(conv?.message_type).toBe("channel");
    expect(conv?.channel_id).toBe("ch-general");
  });

  it("posts an anonymous thread reply when threadRootId is present", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "good point",
      channelId: "ch-general",
      threadRootId: "thread-root-123",
      botClient: client,
    });
    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    expect(client.threadReplies).toHaveLength(1);
    expect(client.threadReplies[0]!.threadRootId).toBe("thread-root-123");
    expect(client.threadReplies[0]!.channelId).toBe("ch-general");
    expect(client.threadReplies[0]!.body.text).toBe("Anonymous: good point");
    expect(ctx.sayCalls.at(-1)?.text).toMatch(/thread/i);
  });

  it("DM takes priority over channel when @mention is present even in a thread", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient({ dmChannelId: "dm-1" });
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>> hi from thread",
      channelId: "ch-general",
      threadRootId: "thread-root-123",
      botClient: client,
    });
    await handler(ctx as any);

    expect(client.posts).toHaveLength(1);
    expect(client.threadReplies).toHaveLength(0);
    expect(ctx.sayCalls.at(-1)?.text).toMatch(/Anonymous message sent/);
  });

  it("rejects empty channel message", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "",
      channelId: "ch-1",
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0]!.text).toMatch(/Usage/);
  });

  it("enforces rate limit on channel posts keyed to channelId", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    for (let i = 0; i < TARGET_RATE_LIMIT; i += 1) {
      const ctx = makeSlashCommandCtx({
        userId: "sender-1",
        text: `msg ${i}`,
        channelId: "ch-same",
        botClient: client,
      });
      await handler(ctx as any);
    }
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "msg overflow",
      channelId: "ch-same",
      botClient: client,
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0]!.text).toMatch(/limit.*channel/i);
  });

  it("writes an audit row with outcome=send-failed when postMessage throws", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient({ dmChannelId: "dm-1" });
    client.v1.messages.postMessageToChannel = async () => {
      throw new Error("boom");
    };
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>> hi",
      botClient: client,
    });

    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    expect(ctx.sayCalls.at(-1)?.text).toMatch(/went wrong/);
    const sendRow = deps.auditLog
      .listRecent(10)
      .find(
        (r) =>
          r.event_type === "SEND" &&
          (r.metadata_json ?? "").includes('"outcome":"send-failed"'),
      );
    expect(sendRow).toBeDefined();
    expect(sendRow!.actor_id).toBe("sender-1");
    expect(sendRow!.target_id).toBe("recipient-1");
  });
});
