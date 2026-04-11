import { describe, it, expect, vi } from "vitest";
import {
  makeAnonReplyModalSubmit,
  makeAnonReplyModalClose,
} from "../../src/views/anonReplyModal";
import { makeTestDeps } from "../helpers/deps";
import { makeViewActionCtx } from "../helpers/ctx";
import { makeFakePumbleClient } from "../helpers/pumbleClient";

describe("anon_reply_modal submit", () => {
  it("sends a reply, flips the direction, and clears pending state", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    await deps.pendingReplies.set("ws-1", "recipient-1", {
      convId: "c1",
      direction: "recipient",
    });
    const client = makeFakePumbleClient();
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "recipient-1",
      state: {
        values: {
          reply_block: { reply_text: { value: "thanks for the feedback" } },
        },
        // Also supply the legacy shape the SDK may use
        reply_block: { reply_text: { value: "thanks for the feedback" } },
      },
      botClient: client,
    });

    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    // Pending state cleared
    expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeUndefined();
    // Reply sent to the ORIGINAL sender (direction flipped)
    expect(client.posts).toHaveLength(1);
    const post = client.posts[0]!;
    expect(post.body.text).toBe("Anonymous reply: thanks for the feedback");
    const actions = post.body.blocks.find((b: any) => b.type === "actions");
    // Direction flipped to "sender" on the new buttons
    expect(actions.elements[0].value).toBe("c1:sender");
  });

  it("acks and no-ops when there is no pending state", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "u1",
      state: { reply_block: { reply_text: { value: "x" } } },
    });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
  });

  it("writes an audit row with outcome=reply-failed when postMessage throws", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    await deps.pendingReplies.set("ws-1", "recipient-1", {
      convId: "c1",
      direction: "recipient",
    });
    const client = makeFakePumbleClient();
    client.v1.messages.postMessageToChannel = async () => {
      throw new Error("boom");
    };
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "recipient-1",
      state: {
        values: { reply_block: { reply_text: { value: "thanks" } } },
      },
      botClient: client,
    });

    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    const replyRow = deps.auditLog
      .listRecent(10)
      .find(
        (r) =>
          r.event_type === "REPLY" &&
          (r.metadata_json ?? "").includes('"outcome":"reply-failed"'),
      );
    expect(replyRow).toBeDefined();
    expect(replyRow!.actor_id).toBe("recipient-1");
    expect(replyRow!.conv_id).toBe("c1");
  });

  it("rejects replies longer than 2000 chars without posting", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    await deps.pendingReplies.set("ws-1", "recipient-1", {
      convId: "c1",
      direction: "recipient",
    });
    const client = makeFakePumbleClient();
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "recipient-1",
      state: {
        reply_block: { reply_text: { value: "x".repeat(2001) } },
      },
      botClient: client,
    });
    await handler(ctx as any);
    expect(client.posts).toHaveLength(0);
  });

  it("sends a message when all guards pass", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    await deps.pendingReplies.set("ws-1", "recipient-1", {
      convId: "c1",
      direction: "recipient",
    });
    const client = makeFakePumbleClient();
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "recipient-1",
      state: {
        values: { reply_block: { reply_text: { value: "thanks" } } },
      },
      botClient: client,
    });

    await handler(ctx as any);

    expect(client.posts).toHaveLength(1);
  });

  it("does not send when the global rate-limit is exhausted", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    await deps.pendingReplies.set("ws-1", "recipient-1", {
      convId: "c1",
      direction: "recipient",
    });
    const client = makeFakePumbleClient();
    vi.spyOn(deps.rateLimit, "checkGlobal").mockReturnValue(false);
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "recipient-1",
      state: {
        values: { reply_block: { reply_text: { value: "thanks" } } },
      },
      botClient: client,
    });

    await handler(ctx as any);

    expect(client.posts).toHaveLength(0);
    const row = deps.auditLog
      .listRecent(10)
      .find((r) => (r.metadata_json ?? "").includes('"outcome":"rate-limited-global"'));
    expect(row).toBeDefined();
  });

  it("does not send when the recipient is blocked and leaves the pending row intact", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    await deps.pendingReplies.set("ws-1", "recipient-1", {
      convId: "c1",
      direction: "recipient",
    });
    const client = makeFakePumbleClient();
    vi.spyOn(deps.repos.blockedUsers, "isBlocked").mockReturnValue(true);
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "recipient-1",
      state: {
        values: { reply_block: { reply_text: { value: "thanks" } } },
      },
      botClient: client,
    });

    await handler(ctx as any);

    expect(client.posts).toHaveLength(0);
    // Handler returns early on block WITHOUT deleting the pending row (24h retention cleans it up).
    expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeDefined();
  });

  it("keeps the pending row when postMessageToChannel throws", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "sender-1", "recipient-1");
    await deps.pendingReplies.set("ws-1", "recipient-1", {
      convId: "c1",
      direction: "recipient",
    });
    const client = makeFakePumbleClient();
    client.v1.messages.postMessageToChannel = async () => {
      throw new Error("network error");
    };
    const handler = makeAnonReplyModalSubmit(deps);
    const ctx = makeViewActionCtx({
      userId: "recipient-1",
      state: {
        values: { reply_block: { reply_text: { value: "thanks" } } },
      },
      botClient: client,
    });

    await handler(ctx as any);

    expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeDefined();
  });
});

describe("anon_reply_modal close", () => {
  it("acks and clears pending state", async () => {
    const deps = makeTestDeps();
    await deps.pendingReplies.set("ws-1", "u1", { convId: "c1", direction: "recipient" });
    const handler = makeAnonReplyModalClose(deps);
    const ctx = makeViewActionCtx({ userId: "u1", state: {} });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
    expect(await deps.pendingReplies.get("ws-1", "u1")).toBeUndefined();
  });
});
