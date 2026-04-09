import { describe, it, expect } from "vitest";
import { makeAppUninstalledHandler } from "../../src/events/appUninstalled";
import { makeAppUnauthorizedHandler } from "../../src/events/appUnauthorized";
import { makeTestDeps } from "../helpers/deps";

describe("APP_UNINSTALLED lifecycle cleanup", () => {
  it("deletes every token row for the workspace and purges pending replies", async () => {
    const deps = makeTestDeps({ useSqlitePendingReplies: true });
    await deps.credentialsStore.saveTokens({
      workspaceId: "ws-1",
      userId: "u1",
      botId: "bot-1",
      accessToken: "u-jwt",
      botToken: "b-jwt",
    });
    deps.pendingRepliesRepo.upsert({
      workspaceId: "ws-1",
      userId: "u1",
      convId: "c1",
      direction: "recipient",
    });
    deps.pendingRepliesRepo.upsert({
      workspaceId: "ws-1",
      userId: "u2",
      convId: "c2",
      direction: "sender",
    });

    const handler = makeAppUninstalledHandler(deps);
    await handler({ payload: { workspaceId: "ws-1" } });

    expect(await deps.credentialsStore.getBotToken("ws-1")).toBeUndefined();
    expect(await deps.credentialsStore.getUserToken("ws-1", "u1")).toBeUndefined();
    expect(deps.pendingRepliesRepo.get("ws-1", "u1")).toBeUndefined();
    expect(deps.pendingRepliesRepo.get("ws-1", "u2")).toBeUndefined();

    // Audit row recorded
    const recent = deps.auditLog.listRecent(10);
    const uninstallRows = recent.filter((r) => r.event_type === "APP_UNINSTALLED");
    expect(uninstallRows).toHaveLength(1);
    expect(uninstallRows[0].workspace_id).toBe("ws-1");
  });

  it("is a no-op on incomplete payloads (no workspace id)", async () => {
    const deps = makeTestDeps();
    const handler = makeAppUninstalledHandler(deps);
    await handler({ payload: {} });
    // No crash, and an audit row is still written for observability
    expect(
      deps.auditLog
        .listRecent(10)
        .filter((r) => r.event_type === "APP_UNINSTALLED")
        .length,
    ).toBe(1);
  });
});

describe("APP_UNAUTHORIZED lifecycle cleanup", () => {
  it("deletes only the user row and leaves bot token intact", async () => {
    const deps = makeTestDeps({ useSqlitePendingReplies: true });
    await deps.credentialsStore.saveTokens({
      workspaceId: "ws-1",
      userId: "u1",
      botId: "bot-1",
      accessToken: "u-jwt",
      botToken: "b-jwt",
    });
    deps.pendingRepliesRepo.upsert({
      workspaceId: "ws-1",
      userId: "u1",
      convId: "c1",
      direction: "recipient",
    });

    const handler = makeAppUnauthorizedHandler(deps);
    await handler({ payload: { workspaceId: "ws-1", userId: "u1" } });

    expect(await deps.credentialsStore.getUserToken("ws-1", "u1")).toBeUndefined();
    expect(await deps.credentialsStore.getBotToken("ws-1")).toBe("b-jwt");
    expect(deps.pendingRepliesRepo.get("ws-1", "u1")).toBeUndefined();

    const recent = deps.auditLog.listRecent(10);
    expect(
      recent.filter((r) => r.event_type === "APP_UNAUTHORIZED"),
    ).toHaveLength(1);
  });
});
