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
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
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
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
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
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
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
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
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
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
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
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
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

  it("refuses to reply and writes a missing-channel-id audit row when a channel conv has NULL channel_id", async () => {
    const deps = makeTestDeps();
    // Bypass the repo writer to construct an illegal row: message_type='channel'
    // but channel_id IS NULL. Represents a corrupt row or a writer bug.
    deps.db
      .prepare(
        "INSERT INTO conversations (id, workspace_id, sender_id, recipient_id, message_type, channel_id) " +
          "VALUES (?, ?, ?, '', 'channel', NULL)",
      )
      .run("c1", "ws-1", "sender-1");
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

    expect(ctx.ackCalls).toBe(1);
    expect(client.posts).toHaveLength(0);
    expect(client.threadReplies).toHaveLength(0);
    const row = deps.auditLog
      .listRecent(10)
      .find(
        (r) =>
          r.event_type === "REPLY" &&
          (r.metadata_json ?? "").includes('"outcome":"missing-channel-id"'),
      );
    expect(row).toBeDefined();
    expect(row!.actor_id).toBe("recipient-1");
    expect(row!.conv_id).toBe("c1");
  });

  // M-6 regression: every reply-modal early return must write an audit
  // row so the audit table is a complete record of every rejection reason.
  // These tests extend the H-5 describe block to also check metadata.outcome.
  describe("M-6: hard-validation early returns write audit rows", () => {
    async function setPending(deps: ReturnType<typeof makeTestDeps>): Promise<void> {
      await deps.pendingReplies.set("ws-1", "recipient-1", {
        convId: "c1",
        direction: "recipient",
      });
    }

    function findReplyRow(
      deps: ReturnType<typeof makeTestDeps>,
      outcome: string,
    ) {
      return deps.auditLog
        .listRecent(10)
        .find(
          (r) =>
            r.event_type === "REPLY" &&
            (r.metadata_json ?? "").includes(`"outcome":"${outcome}"`),
        );
    }

    it("audits no-pending when the modal opens without state", async () => {
      const deps = makeTestDeps();
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "u1",
        state: { values: { reply_block: { reply_text: { value: "hi" } } } },
      });
      await handler(ctx as any);
      expect(findReplyRow(deps, "no-pending")).toBeDefined();
    });

    it("audits empty on whitespace-only reply", async () => {
      const deps = makeTestDeps();
      deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "   " } } } },
      });
      await handler(ctx as any);
      expect(findReplyRow(deps, "empty")).toBeDefined();
    });

    it("audits too-long on oversized reply", async () => {
      const deps = makeTestDeps();
      deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "x".repeat(2001) } } } },
      });
      await handler(ctx as any);
      expect(findReplyRow(deps, "too-long")).toBeDefined();
    });

    it("audits conv-not-found on orphan pending row", async () => {
      const deps = makeTestDeps();
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "hi" } } } },
      });
      await handler(ctx as any);
      expect(findReplyRow(deps, "conv-not-found")).toBeDefined();
    });

    it("audits self-reply on DM targeting yourself", async () => {
      const deps = makeTestDeps();
      deps.repos.conversations.insert(
        "c1",
        "ws-1",
        "recipient-1",
        "other-1",
        "original body",
      );
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "to myself" } } } },
      });
      await handler(ctx as any);
      expect(findReplyRow(deps, "self-reply")).toBeDefined();
    });
  });

  // H-5 regression: hard-validation early-returns must clear the pending
  // reply so the same stale state can't re-open the modal on retry.
  // (The catch-block still leaves it — retry is correct for Pumble-API errors.)
  describe("H-5: hard-validation early returns clear pending state", () => {
    async function setPending(deps: ReturnType<typeof makeTestDeps>): Promise<void> {
      await deps.pendingReplies.set("ws-1", "recipient-1", {
        convId: "c1",
        direction: "recipient",
      });
    }

    it("clears pending on empty reply text", async () => {
      const deps = makeTestDeps();
      deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "   " } } } },
      });
      await handler(ctx as any);
      expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeUndefined();
    });

    it("clears pending on too-long reply text", async () => {
      const deps = makeTestDeps();
      deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "x".repeat(2001) } } } },
      });
      await handler(ctx as any);
      expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeUndefined();
    });

    it("clears pending when the referenced conversation is not found", async () => {
      const deps = makeTestDeps();
      // pending references a convId that never got inserted
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "hi" } } } },
      });
      await handler(ctx as any);
      expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeUndefined();
    });

    it("clears pending when a channel conversation is missing channel_id", async () => {
      const deps = makeTestDeps();
      deps.db
        .prepare(
          "INSERT INTO conversations (id, workspace_id, sender_id, recipient_id, message_type, channel_id) " +
            "VALUES (?, ?, ?, '', 'channel', NULL)",
        )
        .run("c1", "ws-1", "sender-1");
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "hi" } } } },
      });
      await handler(ctx as any);
      expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeUndefined();
    });

    it("clears pending on DM self-reply", async () => {
      const deps = makeTestDeps();
      // Insert a conversation where the reply target (after direction flip)
      // equals the pending user. With direction "recipient", reply goes to
      // conv.sender_id. Set sender_id === the clicker so it's a self-reply.
      deps.repos.conversations.insert(
        "c1",
        "ws-1",
        "recipient-1",
        "other-1",
        "original body",
      );
      await setPending(deps);
      const handler = makeAnonReplyModalSubmit(deps);
      const ctx = makeViewActionCtx({
        userId: "recipient-1",
        state: { values: { reply_block: { reply_text: { value: "to myself" } } } },
      });
      await handler(ctx as any);
      expect(await deps.pendingReplies.get("ws-1", "recipient-1")).toBeUndefined();
    });
  });

  it("keeps the pending row when postMessageToChannel throws", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "original body");
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
