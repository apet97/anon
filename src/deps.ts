import type { CredentialsStore } from "pumble-sdk";
import type { AppConfig } from "./config";
import type { Repos } from "./db/repos";
import type { PendingRepliesRepo } from "./db/repos/pendingRepliesRepo";
import type { AuditLogRepo } from "./db/repos/auditLogRepo";
import type { AnonMessageService } from "./services/anonMessage";
import type { RateLimitService } from "./services/rateLimit";
import type { ReportChannelService } from "./services/reportChannel";
import type { PendingRepliesService } from "./services/pendingReplies";
import type { Logger } from "./logger";

/**
 * Dependency bag passed to every handler factory. Centralising it
 * here keeps the factory signatures uniform and makes it trivial
 * for tests to build a partial set of fakes.
 *
 * `credentialsStore` and `pendingRepliesRepo` are only consumed by
 * the lifecycle event handlers, but they live in the shared bag so
 * that adding future handlers does not require another refactor.
 */
export interface AppDeps {
  config: AppConfig;
  repos: Repos;
  pendingRepliesRepo: PendingRepliesRepo;
  auditLog: AuditLogRepo;
  anonMessage: AnonMessageService;
  rateLimit: RateLimitService;
  reportChannel: ReportChannelService;
  pendingReplies: PendingRepliesService;
  credentialsStore: CredentialsStore;
  logger: Logger;
}
