import { describe, it, expect } from "vitest";
import { makeReportAnonHandler } from "../../src/interactions/reportAnon";
import { makeTestDeps } from "../helpers/deps";
import { makeBlockInteractionCtx } from "../helpers/ctx";
import { makeFakePumbleClient } from "../helpers/pumbleClient";
import { REPORT_CHANNEL_CONFIG_KEY } from "../../src/services/reportChannel";

const WS = "ws-1";

describe("report_anon interaction", () => {
  it("acks and returns when the payload is not valid JSON", async () => {
    const deps = makeTestDeps();
    const handler = makeReportAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({ userId: "u1", value: "ignored" });
    (ctx as any).payload.payload = "not-json{{{";
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
  });

  it("acks and returns when direction is not recipient or sender", async () => {
    const deps = makeTestDeps();
    const handler = makeReportAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({ userId: "u1", value: "conv-1:baddir" });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
  });

  it("posts an abuse report after the conversation and channel resolve", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", WS, "sender-1", "recipient-1", "something mean");
    deps.repos.config.set(WS, REPORT_CHANNEL_CONFIG_KEY, "report-channel-1");
    const client = makeFakePumbleClient();
    const handler = makeReportAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({
      userId: "recipient-1",
      value: "c1:recipient",
      botClient: client,
    });

    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    expect(client.posts).toHaveLength(1);
    const post = client.posts[0]!;
    expect(post.channelId).toBe("report-channel-1");
    expect(post.body.text).toContain("<@sender-1>");
    expect(post.body.text).toContain("<@recipient-1>");
  });

  it("truncates long previews to 200 characters", async () => {
    const deps = makeTestDeps();
    const longBody = "a".repeat(300);
    deps.repos.conversations.insert("c1", WS, "sender-1", "recipient-1", longBody);
    deps.repos.config.set(WS, REPORT_CHANNEL_CONFIG_KEY, "rc1");
    const client = makeFakePumbleClient();
    const handler = makeReportAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({
      userId: "recipient-1",
      value: "c1:recipient",
      botClient: client,
    });
    await handler(ctx as any);
    const blocks = client.posts[0]!.body.blocks;
    const quoteBlock = blocks[0].elements.find(
      (e: any) => e.type === "rich_text_quote",
    );
    const previewText: string = quoteBlock.elements[0].text;
    expect(previewText.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(previewText.endsWith("...")).toBe(true);
  });

  it("silently acks when the conversation is unknown", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeReportAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({
      userId: "u1",
      value: "ghost:recipient",
      botClient: client,
    });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
    expect(client.posts).toHaveLength(0);
  });

  it("flips the sender identity when direction=sender", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", WS, "sender-1", "recipient-1", "reply body");
    deps.repos.config.set(WS, REPORT_CHANNEL_CONFIG_KEY, "rc1");
    const client = makeFakePumbleClient();
    const handler = makeReportAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({
      userId: "sender-1",
      value: "c1:sender",
      botClient: client,
    });
    await handler(ctx as any);
    const post = client.posts[0]!;
    expect(post.body.text).toContain("<@recipient-1>");
  });

  // H-3 regression: a sender clicking Report on their own anonymous
  // message must not post anything to the admin channel — otherwise the
  // reporter dox'es themselves. The handler must still ack (returning
  // HTTP 200) and write an audit row for visibility.
  it("blocks self-reports without posting to the admin channel", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", WS, "sender-1", "recipient-1", "hello");
    deps.repos.config.set(WS, REPORT_CHANNEL_CONFIG_KEY, "rc1");
    const client = makeFakePumbleClient();
    const handler = makeReportAnonHandler(deps);
    // The original sender ("sender-1") is clicking Report with direction=sender,
    // which would otherwise resolve anonSenderId to recipient_id. To get
    // anonSenderId === reporterId we use direction=recipient so that
    // anonSenderId = conv.sender_id === reporter userId.
    const ctx = makeBlockInteractionCtx({
      userId: "sender-1",
      value: "c1:recipient",
      botClient: client,
    });

    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    expect(client.posts).toHaveLength(0);
    const selfReportRow = deps.auditLog
      .listRecent(10)
      .find(
        (r) =>
          r.event_type === "REPORT" &&
          (r.metadata_json ?? "").includes('"outcome":"self-report"'),
      );
    expect(selfReportRow).toBeDefined();
    expect(selfReportRow!.actor_id).toBe("sender-1");
    expect(selfReportRow!.conv_id).toBe("c1");
  });

  it("writes an audit row with outcome=post-failed when posting the report throws", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", WS, "sender-1", "recipient-1", "hello");
    deps.repos.config.set(WS, REPORT_CHANNEL_CONFIG_KEY, "rc1");
    const client = makeFakePumbleClient();
    client.v1.messages.postMessageToChannel = async () => {
      throw new Error("boom");
    };
    const handler = makeReportAnonHandler(deps);
    const ctx = makeBlockInteractionCtx({
      userId: "recipient-1",
      value: "c1:recipient",
      botClient: client,
    });

    await handler(ctx as any);

    expect(ctx.ackCalls).toBe(1);
    const reportRow = deps.auditLog
      .listRecent(10)
      .find((r) => r.event_type === "REPORT");
    expect(reportRow).toBeDefined();
    expect(reportRow!.metadata_json).toBeTruthy();
    expect(reportRow!.metadata_json).toContain('"outcome":"post-failed"');
  });
});
