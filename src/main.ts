import { start, JsonFileTokenStore } from "pumble-sdk";
import { loadConfig } from "./config";
import { openDb } from "./db/connection";
import { makeRepos } from "./db/repos";
import { makeLogger } from "./logger";
import { makeRateLimitService } from "./services/rateLimit";
import { makeAnonMessageService } from "./services/anonMessage";
import { makeReportChannelService } from "./services/reportChannel";
import { makeInMemoryPendingRepliesService } from "./services/pendingReplies";
import { createApp } from "./app";
import type { AppDeps } from "./deps";

/**
 * Runtime bootstrap: load env-validated config, open the database,
 * assemble the dependency bag, and hand the resulting `App` to the
 * Pumble SDK's `start()`.
 *
 * This module has side effects and is explicitly excluded from the
 * vitest coverage scope. Any logic that needs testing belongs in
 * `src/app.ts` or the individual service/handler modules.
 *
 * Phase 5 swaps `makeInMemoryPendingRepliesService` for the SQLite
 * implementation and the `JsonFileTokenStore` for the custom
 * `SqliteCredentialsStore`. Neither change requires touching
 * anything below.
 */

const config = loadConfig();
const logger = makeLogger({
  level: config.logLevel,
  prettyPrint: config.nodeEnv === "development",
});

logger.info(
  { nodeEnv: config.nodeEnv, port: config.port, dbPath: config.databasePath },
  "anon bootstrap",
);

const db = openDb(config.databasePath);
const repos = makeRepos(db);

const rateLimit = makeRateLimitService({
  rateLimits: repos.rateLimits,
  targetLimits: repos.targetLimits,
});
const anonMessage = makeAnonMessageService({
  conversations: repos.conversations,
  logger,
});
const reportChannel = makeReportChannelService({
  config: repos.config,
  logger,
});
const pendingReplies = makeInMemoryPendingRepliesService();

const deps: AppDeps = {
  config,
  repos,
  anonMessage,
  rateLimit,
  reportChannel,
  pendingReplies,
  logger,
};

const tokenStore = new JsonFileTokenStore("tokens.json");

start(createApp(deps, tokenStore));
