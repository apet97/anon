import { describe, it, expect } from "vitest";
import { makeAnonBlockCommand } from "../../src/commands/anonBlock";
import { makeAnonUnblockCommand } from "../../src/commands/anonUnblock";
import { makeTestDeps } from "../helpers/deps";
import { makeSlashCommandCtx } from "../helpers/ctx";

describe("/anon-block and /anon-unblock", () => {
  it("block inserts the user and acks within the contract", async () => {
    const deps = makeTestDeps();
    const handler = makeAnonBlockCommand(deps).handler;
    const ctx = makeSlashCommandCtx({ userId: "u1", text: "" });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
    expect(deps.repos.blockedUsers.isBlocked("u1")).toBe(true);
    expect(ctx.sayCalls[0]!.text).toMatch(/will no longer/);
  });

  it("unblock removes the user and acks", async () => {
    const deps = makeTestDeps();
    deps.repos.blockedUsers.block("u1");
    const handler = makeAnonUnblockCommand(deps).handler;
    const ctx = makeSlashCommandCtx({ userId: "u1", text: "" });
    await handler(ctx as any);
    expect(ctx.ackCalls).toBe(1);
    expect(deps.repos.blockedUsers.isBlocked("u1")).toBe(false);
    expect(ctx.sayCalls[0]!.text).toMatch(/again/);
  });
});
