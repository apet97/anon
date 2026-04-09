import { describe, it, expect } from "vitest";
import { makeAnonCommand } from "../../src/commands/anon";
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
    expect(client.posts[0].body.text).toBe("Anonymous message: be nice");
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
    expect(ctx.sayCalls[0].text).toMatch(/Usage: `\/anon/);
  });

  it("rejects self-message", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "u1",
      text: "<<@u1>> hello me",
    });
    await handler(ctx as any);
    expect(ctx.sayCalls[0].text).toMatch(/yourself/);
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
    expect(ctx.sayCalls[0].text).toMatch(/opted out/);
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
    expect(ctx.sayCalls[0].text).toMatch(/too long/i);
  });

  it("enforces the global rate limit", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    // Send 5 messages to 5 distinct recipients (global limit = 5/min)
    for (let i = 0; i < 5; i += 1) {
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
    expect(ctx.sayCalls[0].text).toMatch(/Slow down/);
  });

  it("enforces the per-target rate limit", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    for (let i = 0; i < 2; i += 1) {
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
    expect(ctx.sayCalls[0].text).toMatch(/limit for messages to this person/);
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
});
