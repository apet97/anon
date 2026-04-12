import { describe, it, expect } from "vitest";
import { makeReportChannelService, REPORT_CHANNEL_CONFIG_KEY } from "../../src/services/reportChannel";
import { makeTestDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { makeTestLogger } from "../helpers/logger";
import { makeFakePumbleClient } from "../helpers/pumbleClient";

const WS = "ws-1";

describe("reportChannel.getOrCreate", () => {
  it("returns the cached channel id when config has it", async () => {
    const { repos } = makeTestDb();
    repos.config.set(WS, REPORT_CHANNEL_CONFIG_KEY, "cached-id");
    const svc = makeReportChannelService({ config: repos.config, logger: makeTestLogger() });
    const client = makeFakePumbleClient();
    const result = await svc.getOrCreate(client as any, WS);
    expect(result).toBe("cached-id");
    expect(client.channelCreates).toHaveLength(0);
    expect(client.posts).toHaveLength(0);
  });

  it("reuses an existing PRIVATE channel named abot-reports", async () => {
    const { repos } = makeTestDb();
    const svc = makeReportChannelService({ config: repos.config, logger: makeTestLogger() });
    const client = makeFakePumbleClient({
      existingChannels: [{ id: "existing-abot-reports", name: "abot-reports" }],
    });
    const result = await svc.getOrCreate(client as any, WS);
    expect(result).toBe("existing-abot-reports");
    expect(repos.config.get(WS, REPORT_CHANNEL_CONFIG_KEY)).toBe("existing-abot-reports");
    expect(client.channelCreates).toHaveLength(0);
  });

  it("creates a new channel, invites admins, and posts the onboarding message", async () => {
    const { repos } = makeTestDb();
    const svc = makeReportChannelService({ config: repos.config, logger: makeTestLogger() });
    const client = makeFakePumbleClient({
      workspaceUsers: [
        { id: "owner-1", role: "OWNER" },
        { id: "admin-1", role: "ADMIN" },
        { id: "member-1", role: "MEMBER" },
      ],
      createChannelId: "fresh-abot-reports",
    });
    const result = await svc.getOrCreate(client as any, WS);
    expect(result).toBe("fresh-abot-reports");
    expect(client.channelCreates).toHaveLength(1);
    expect(client.channelCreates[0]!.args).toMatchObject({
      name: "abot-reports",
      type: "PRIVATE",
    });
    expect(client.addedToChannel).toEqual([
      { channelId: "fresh-abot-reports", userIds: ["owner-1", "admin-1"] },
    ]);
    expect(client.posts).toHaveLength(1);
    expect(client.posts[0]!.channelId).toBe("fresh-abot-reports");
    expect(repos.config.get(WS, REPORT_CHANNEL_CONFIG_KEY)).toBe("fresh-abot-reports");
  });

  it("writes an audit row with outcome=setup-failed when listChannels throws", async () => {
    const deps = makeTestDeps();
    const svc = makeReportChannelService({
      config: deps.repos.config,
      logger: makeTestLogger(),
      auditLog: deps.auditLog,
    });
    const client = makeFakePumbleClient();
    client.v1.channels.listChannels = async () => {
      throw new Error("boom");
    };

    const result = await svc.getOrCreate(client as any, WS);

    expect(result).toBeNull();
    const setupRow = deps.auditLog
      .listRecent(10)
      .find(
        (r) =>
          r.event_type === "REPORT_CHANNEL_SETUP" &&
          (r.metadata_json ?? "").includes('"outcome":"setup-failed"'),
      );
    expect(setupRow).toBeDefined();
    expect(setupRow!.metadata_json).toContain('"err":"boom"');
  });
});
