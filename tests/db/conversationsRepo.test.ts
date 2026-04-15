import { describe, it, expect } from "vitest";
import { makeTestDb } from "../helpers/db";

// C-3 regression: conversations.get must be scoped by workspaceId so a
// row created in one workspace can never be read from another, even if
// the caller guesses a valid convId.
describe("conversationsRepo.get workspace scoping", () => {
  it("returns the row when called with the correct workspaceId", () => {
    const { repos } = makeTestDb();
    repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "hi");
    const row = repos.conversations.get("ws-1", "c1");
    expect(row).toBeDefined();
    expect(row!.sender_id).toBe("sender-1");
    expect(row!.last_message).toBe("hi");
  });

  it("returns undefined when the workspaceId does not match", () => {
    const { repos } = makeTestDb();
    repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "hi");
    expect(repos.conversations.get("ws-2", "c1")).toBeUndefined();
  });

  it("returns undefined for an unknown id even in the same workspace", () => {
    const { repos } = makeTestDb();
    repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "hi");
    expect(repos.conversations.get("ws-1", "does-not-exist")).toBeUndefined();
  });

  it("scopes insertChannel rows the same way", () => {
    const { repos } = makeTestDb();
    repos.conversations.insertChannel(
      "c1",
      "ws-1",
      "sender-1",
      "ch-1",
      "channel",
      "hello channel",
    );
    expect(repos.conversations.get("ws-1", "c1")?.message_type).toBe("channel");
    expect(repos.conversations.get("ws-2", "c1")).toBeUndefined();
  });
});
