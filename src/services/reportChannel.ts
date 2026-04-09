import type { ApiClient } from "pumble-sdk";
import type { ConfigRepo } from "../db/repos/configRepo";
import type { Logger } from "../logger";

/**
 * Discovers or creates the private `#abot-reports` channel used to
 * collect abuse reports. The channel ID is cached in the `config`
 * table under `report_channel_id` so we only pay the listChannels +
 * createChannel round trip once per workspace.
 *
 * On creation, every workspace user with role OWNER or ADMIN is
 * invited and an onboarding message is posted so readers understand
 * what the channel is for.
 */
export const REPORT_CHANNEL_NAME = "abot-reports";
export const REPORT_CHANNEL_CONFIG_KEY = "report_channel_id";
const ONBOARDING_TEXT =
  "This channel receives anonymous message abuse reports. Each report includes the sender's real identity.";

export interface ReportChannelService {
  getOrCreate(client: ApiClient): Promise<string | null>;
}

export interface ReportChannelDeps {
  config: ConfigRepo;
  logger: Logger;
}

export function makeReportChannelService(
  deps: ReportChannelDeps,
): ReportChannelService {
  return {
    async getOrCreate(client) {
      const cached = deps.config.get(REPORT_CHANNEL_CONFIG_KEY);
      if (cached) {
        return cached;
      }

      try {
        const channels = await client.v1.channels.listChannels(["PRIVATE"]);
        const existing = channels.find(
          (c) => c.channel.name === REPORT_CHANNEL_NAME,
        );
        if (existing) {
          deps.config.set(REPORT_CHANNEL_CONFIG_KEY, existing.channel.id);
          return existing.channel.id;
        }

        const newChannel = await client.v1.channels.createChannel({
          name: REPORT_CHANNEL_NAME,
          type: "PRIVATE",
          description: "Anonymous message abuse reports from Abot",
        });
        const channelId = newChannel.channel.id;
        deps.config.set(REPORT_CHANNEL_CONFIG_KEY, channelId);

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

        return channelId;
      } catch (err) {
        deps.logger.error(
          { err: (err as Error).message, outcome: "report-channel-setup-failed" },
          "failed to set up report channel",
        );
        return null;
      }
    },
  };
}
