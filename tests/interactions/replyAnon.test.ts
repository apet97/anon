import { describe, it, expect } from "vitest";
import { makeReplyAnonHandler } from "../../src/interactions/replyAnon";
import { makeTestDeps } from "../helpers/deps";
import { makeBlockInteractionCtx } from "../helpers/ctx";

describe("reply_anon interaction", () => {
  it("acks and returns when the payload is not valid JSON", async () => {
    const deps = makeTestDeps();
    const handler = makeReplyAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({ userId: "u1", value: "ignored" });
    (ctx as any).payload.payload = "not-json{{{";
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
    expect(ctx.spawnedModals).toHaveLength(0);
  });

  it("acks and returns when direction is not recipient or sender", async () => {
    const deps = makeTestDeps();
    const handler = makeReplyAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({ userId: "u1", value: "conv-1:baddir" });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
    expect(ctx.spawnedModals).toHaveLength(0);
  });

  it("stores pending reply state and opens the modal WITHOUT calling ack", async () => {
    const deps = makeTestDeps();
    const handler = makeReplyAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({
      userId: "u1",
      value: "conv-1:recipient",
    });
    await handler(ctx as any);
    // Critical: no ack when spawning a modal
    expect(ctx.ackCalls).toBe(0);
    expect(ctx.spawnedModals).toHaveLength(1);
    const modal = ctx.spawnedModals[0];
    expect(modal.callbackId).toBe("anon_reply_modal");
    expect(modal.notifyOnClose).toBe(true);
    // The textarea uses line_mode, not the silently-ignored multiline prop
    const element = modal.blocks[0].element;
    expect(element.type).toBe("plain_text_input");
    expect(element.line_mode).toBe("multiline");
    expect(element.multiline).toBeUndefined();
    // Pending state persisted
    const pending = await deps.pendingReplies.get("ws-1", "u1");
    expect(pending).toEqual({ convId: "conv-1", direction: "recipient" });
  });
});
