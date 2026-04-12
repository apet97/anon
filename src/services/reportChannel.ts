import type { ApiClient } from "pumble-sdk";
import type { ConfigRepo } from "../db/repos/configRepo";
import type { AuditLogRepo } from "../db/repos/auditLogRepo";
import type { Logger } from "../logger";

export const REPORT_CHANNEL_NAME = "abot-reports";
export const REPORT_CHANNEL_CONFIG_KEY = "report_channel_id";
const ONBOARDING_TEXT =
  "This channel receives anonymous message abuse reports. Each report includes the sender's real identity.";

export interface ReportChannelService {
  getOrCreate(client: ApiClient, workspaceId: string): Promise<string | null>;
}

export interface ReportChannelDeps {
  config: ConfigRepo;
  logger: Logger;
  auditLog?: AuditLogRepo;
}

export function makeReportChannelService(
  deps: ReportChannelDeps,
): ReportChannelService {
  const inflightCreates = new Map<string, Promise<string | null>>();

  const doCreate = async (client: ApiClient, workspaceId: string): Promise<string | null> => {
    try {
      const rechecked = deps.config.get(workspaceId, REPORT_CHANNEL_CONFIG_KEY);
      if (rechecked) return rechecked;

      const channels = await client.v1.channels.listChannels(["PRIVATE"]);
      const existing = channels.find(
        (c) => c.channel.name === REPORT_CHANNEL_NAME,
      );
      if (existing) {
        deps.config.set(workspaceId, REPORT_CHANNEL_CONFIG_KEY, existing.channel.id);
        return existing.channel.id;
      }

      const newChannel = await client.v1.channels.createChannel({
        name: REPORT_CHANNEL_NAME,
        type: "PRIVATE",
        description: "Anonymous message abuse reports from Anon",
      });
      const channelId = newChannel.channel.id;

      const users = await client.v1.users.listWorkspaceUsers();
      const adminIds = users
        .filter((u) => ["OWNER", "ADMIN"].includes(u.role))
        .map((u) => u.id);
      if (adminIds.length > 0) {
        await client.v1.channels.addUsersToChannel(channelId, {
          userIds: adminIds,
        });
      }

      await client.v1.messages.postMessageToChannel(channelId, {
        text: ONBOARDING_TEXT,
      });

      deps.config.set(workspaceId, REPORT_CHANNEL_CONFIG_KEY, channelId);
      return channelId;
    } catch (err) {
      deps.logger.error(
        {
          eventType: "REPORT_CHANNEL_SETUP",
          err: (err as Error).message,
          outcome: "setup-failed",
        },
        "failed to set up report channel",
      );
      deps.auditLog?.record({
        eventType: "REPORT_CHANNEL_SETUP",
        metadata: { outcome: "setup-failed", err: (err as Error).message },
      });
      return null;
    } finally {
      inflightCreates.delete(workspaceId);
    }
  };

  return {
    async getOrCreate(client, workspaceId) {
      const cached = deps.config.get(workspaceId, REPORT_CHANNEL_CONFIG_KEY);
      if (cached) {
        return cached;
      }

      let inflight = inflightCreates.get(workspaceId);
      if (!inflight) {
        inflight = doCreate(client, workspaceId);
        inflightCreates.set(workspaceId, inflight);
      }

      return inflight;
    },
  };
}
