import type { AppConfig } from "./config";
import type { Repos } from "./db/repos";
import type { AnonMessageService } from "./services/anonMessage";
import type { RateLimitService } from "./services/rateLimit";
import type { ReportChannelService } from "./services/reportChannel";
import type { PendingRepliesService } from "./services/pendingReplies";
import type { Logger } from "./logger";

/**
 * Dependency bag passed to every handler factory. Centralising it
 * here keeps the factory signatures uniform and makes it trivial
 * for tests to build a partial set of fakes.
 */
export interface AppDeps {
  config: AppConfig;
  repos: Repos;
  anonMessage: AnonMessageService;
  rateLimit: RateLimitService;
  reportChannel: ReportChannelService;
  pendingReplies: PendingRepliesService;
  logger: Logger;
}
