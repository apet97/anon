import { describe, it, expect } from "vitest";
import { makeAppUninstalledHandler } from "../../src/events/appUninstalled";
import { makeAppUnauthorizedHandler } from "../../src/events/appUnauthorized";
import { makeTestDeps } from "../helpers/deps";

/** Build a minimal SDK event context for testing — the handlers only read payload fields. */
function makeEventCtx(payload: Record<string, unknown>) {
  return {
    payload,
    getBotClient: async () => undefined,
    getUserClient: async () => undefined,
    getBotUserId: async () => undefined,
    getAuthUrl: () => "",
    getManifest: () => ({}),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("APP_UNINSTALLED lifecycle cleanup", () => {
  it("deletes every token row for the workspace and purges all workspace-scoped data", async () => {
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
    deps.repos.blockedUsers.block("ws-1", "u1");
    deps.repos.config.set("ws-1", "report_channel_id", "rc-1");

    // Also insert data for ws-2 to verify it survives
    deps.repos.blockedUsers.block("ws-2", "u1");
    deps.repos.config.set("ws-2", "report_channel_id", "rc-2");

    const handler = makeAppUninstalledHandler(deps);
    await handler(makeEventCtx({ workspaceId: "ws-1" }));

    expect(await deps.credentialsStore.getBotToken("ws-1")).toBeUndefined();
    expect(await deps.credentialsStore.getUserToken("ws-1", "u1")).toBeUndefined();
    expect(deps.pendingRepliesRepo.get("ws-1", "u1")).toBeUndefined();
    expect(deps.pendingRepliesRepo.get("ws-1", "u2")).toBeUndefined();
    expect(deps.repos.blockedUsers.isBlocked("ws-1", "u1")).toBe(false);
    expect(deps.repos.config.get("ws-1", "report_channel_id")).toBeUndefined();

    // ws-2 data survives
    expect(deps.repos.blockedUsers.isBlocked("ws-2", "u1")).toBe(true);
    expect(deps.repos.config.get("ws-2", "report_channel_id")).toBe("rc-2");

    // Audit row recorded
    const recent = deps.auditLog.listRecent(10);
    const uninstallRows = recent.filter((r) => r.event_type === "APP_UNINSTALLED");
    expect(uninstallRows).toHaveLength(1);
    expect(uninstallRows[0]!.workspace_id).toBe("ws-1");
  });

  it("is a no-op on incomplete payloads (no workspace id)", async () => {
    const deps = makeTestDeps();
    const handler = makeAppUninstalledHandler(deps);
    await handler(makeEventCtx({}));
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
    // body.workspaceUser is the revoked user ID per NotificationAppUnauthorized shape.
    await handler(makeEventCtx({ workspaceId: "ws-1", body: { workspaceUser: "u1" } }));

    expect(await deps.credentialsStore.getUserToken("ws-1", "u1")).toBeUndefined();
    expect(await deps.credentialsStore.getBotToken("ws-1")).toBe("b-jwt");
    expect(deps.pendingRepliesRepo.get("ws-1", "u1")).toBeUndefined();

    const recent = deps.auditLog.listRecent(10);
    expect(
      recent.filter((r) => r.event_type === "APP_UNAUTHORIZED"),
    ).toHaveLength(1);
  });

  it("skips cleanup but still audits when workspaceUserId is missing", async () => {
    const deps = makeTestDeps({ useSqlitePendingReplies: true });
    await deps.credentialsStore.saveTokens({
      workspaceId: "ws-1",
      userId: "u1",
      botId: "bot-1",
      accessToken: "u-jwt",
      botToken: "b-jwt",
    });

    const handler = makeAppUnauthorizedHandler(deps);
    // body.workspaceUser absent → workspaceUserId is undefined → guard skips cleanup
    await handler(makeEventCtx({ workspaceId: "ws-1", body: {} }));

    // Token must survive
    expect(await deps.credentialsStore.getBotToken("ws-1")).toBe("b-jwt");
    // Audit row still written for observability
    expect(
      deps.auditLog.listRecent(10).filter((r) => r.event_type === "APP_UNAUTHORIZED"),
    ).toHaveLength(1);
  });

  it("skips cleanup but still audits when workspaceId is missing", async () => {
    const deps = makeTestDeps();

    const handler = makeAppUnauthorizedHandler(deps);
    await handler(makeEventCtx({ body: { workspaceUser: "u1" } }));

    expect(
      deps.auditLog.listRecent(10).filter((r) => r.event_type === "APP_UNAUTHORIZED"),
    ).toHaveLength(1);
  });
});
