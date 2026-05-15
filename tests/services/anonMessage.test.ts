import { describe, it, expect } from "vitest";
import { makeAnonMessageService } from "../../src/services/anonMessage";
import { makeTestLogger } from "../helpers/logger";
import { makeFakePumbleClient } from "../helpers/pumbleClient";

describe("anonMessage.send", () => {
  it("posts to the recipient's DM channel and attaches reply+report buttons", async () => {
    const svc = makeAnonMessageService({
      logger: makeTestLogger(),
    });
    const client = makeFakePumbleClient({ dmChannelId: "dm-1" });

    const ok = await svc.send({
      client: client as any,
      targetId: "recipient-1",
      label: "Anonymous message",
      messageText: "hello world",
      convId: "c1",
      direction: "recipient",
    });

    expect(ok).toBe(true);
    expect(client.posts).toHaveLength(1);
    const post = client.posts[0]!;
    expect(post.channelId).toBe("dm-1");
    expect(post.body.text).toBe("Anonymous message: hello world");
    // Both action buttons present with combined value
    const actionsBlock = post.body.blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[0]).toMatchObject({
      onAction: "reply_anon",
      value: "c1:recipient",
      style: "primary",
      text: { text: "Reply Anonymously" },
    });
    expect(actionsBlock.elements[1]).toMatchObject({
      onAction: "report_anon",
      value: "c1:recipient",
      style: "danger",
    });
  });
});

describe("anonMessage.sendToChannel", () => {
  it("returns the Pumble message id so the caller can write thread_root_id", async () => {
    const svc = makeAnonMessageService({
      logger: makeTestLogger(),
    });
    const client = makeFakePumbleClient();

    const messageId = await svc.sendToChannel({
      client: client as any,
      channelId: "ch-general",
      messageText: "hello channel",
      convId: "c1",
    });

    expect(messageId).toBe("fake-msg-1");
    expect(client.channelPosts).toHaveLength(1);
    expect(client.channelPosts[0]!.channelId).toBe("ch-general");
    expect(client.channelPosts[0]!.body.text).toBe("Anonymous: hello channel");
    const actionsBlock = client.channelPosts[0]!.body.blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock.elements[0]).toMatchObject({
      onAction: "reply_anon",
      text: { text: "Reply Anonymously in Thread" },
    });
  });
});

describe("anonMessage.replyInThread", () => {
  it("posts to the given thread via client.v1.messages.reply without touching the DB", async () => {
    const svc = makeAnonMessageService({
      logger: makeTestLogger(),
    });
    const client = makeFakePumbleClient();

    const ok = await svc.replyInThread({
      client: client as any,
      threadRootId: "root-1",
      channelId: "ch-general",
      messageText: "thread reply",
      convId: "c1",
    });

    expect(ok).toBe(true);
    expect(client.threadReplies).toHaveLength(1);
    expect(client.threadReplies[0]!.threadRootId).toBe("root-1");
    expect(client.threadReplies[0]!.channelId).toBe("ch-general");
    const actionsBlock = client.threadReplies[0]!.body.blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock.elements[0]).toMatchObject({
      onAction: "reply_anon",
      text: { text: "Reply Anonymously in Thread" },
    });
  });
});
