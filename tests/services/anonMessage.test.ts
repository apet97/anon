import { describe, it, expect } from "vitest";
import { makeAnonMessageService } from "../../src/services/anonMessage";
import { makeTestDb } from "../helpers/db";
import { makeTestLogger } from "../helpers/logger";
import { makeFakePumbleClient } from "../helpers/pumbleClient";

describe("anonMessage.send", () => {
  it("posts to the recipient's DM channel and attaches reply+report buttons", async () => {
    const { repos } = makeTestDb();
    repos.conversations.insert("c1", "sender-1", "recipient-1");
    const svc = makeAnonMessageService({
      conversations: repos.conversations,
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
    });
    expect(actionsBlock.elements[1]).toMatchObject({
      onAction: "report_anon",
      value: "c1:recipient",
      style: "danger",
    });
    // Last message saved for future report preview
    expect(repos.conversations.get("c1")?.last_message).toBe("hello world");
  });
});
