import type { ApiClient } from "pumble-sdk";
import type { ConfigRepo } from "../db/repos/configRepo";
import type { AuditLogRepo } from "../db/repos/auditLogRepo";
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
  // Optional so main.ts can wire it in a follow-up without breaking
  // the boot sequence. When present, setup failures are recorded to
  // audit_log with eventType "REPORT_CHANNEL_SETUP".
  auditLog?: AuditLogRepo;
}

export function makeReportChannelService(
  deps: ReportChannelDeps,
): ReportChannelService {
  // In-flight guard: prevents concurrent first-report calls from
  // creating duplicate #abot-reports channels. Both callers await the
  // same promise and get the same channel ID.
  let inflightCreate: Promise<string | null> | null = null;

  const doCreate = async (client: ApiClient): Promise<string | null> => {
    try {
      // Re-check after acquiring — a concurrent call may have written
      // the config row while the previous inflightCreate was running.
      const rechecked = deps.config.get(REPORT_CHANNEL_CONFIG_KEY);
      if (rechecked) return rechecked;

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
        description: "Anonymous message abuse reports from Anon",
      });
      const channelId = newChannel.channel.id;
      // NOTE: config.set is intentionally deferred to AFTER admin invites and
      // onboarding post succeed — caching a half-initialised channel would
      // mean reports land in a channel with no admin members.

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

      // Only cache after full setup is confirmed.
      deps.config.set(REPORT_CHANNEL_CONFIG_KEY, channelId);
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
      inflightCreate = null;
    }
  };

  return {
    async getOrCreate(client) {
      const cached = deps.config.get(REPORT_CHANNEL_CONFIG_KEY);
      if (cached) {
        return cached;
      }

      if (!inflightCreate) {
        inflightCreate = doCreate(client);
      }

      return inflightCreate;
    },
  };
}
