import * as path from "path";
import { start } from "pumble-sdk";
import { loadConfig } from "./config";
import { openDb } from "./db/connection";
import { makeRepos } from "./db/repos";
import { makePendingRepliesRepo } from "./db/repos/pendingRepliesRepo";
import { makeAuditLogRepo } from "./db/repos/auditLogRepo";
import { runMigrations } from "./db/migrations/migrator";
import { makeLogger } from "./logger";
import { makeRateLimitService } from "./services/rateLimit";
import { makeAnonMessageService } from "./services/anonMessage";
import { makeReportChannelService } from "./services/reportChannel";
import { makeSqlitePendingRepliesService } from "./services/pendingReplies";
import { SqliteCredentialsStore } from "./tokens/sqliteCredentialsStore";
import { createApp } from "./app";
import type { AppDeps } from "./deps";

/**
 * Runtime bootstrap: load env-validated config, open the database,
 * run migrations, assemble the dependency bag, and hand the resulting
 * `App` to the Pumble SDK's `start()`.
 *
 * This module has side effects and is explicitly excluded from the
 * vitest coverage scope. All logic that needs testing lives in
 * `src/app.ts`, the service modules, or the individual handler
 * factories — each of which is pure with respect to the filesystem
 * and environment.
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
const migrationsDir = path.resolve(__dirname, "db/migrations");
const migrationResult = runMigrations(db, migrationsDir);
logger.info(
  {
    migrationsApplied: migrationResult.applied,
    migrationsSkipped: migrationResult.skipped,
  },
  "migrations complete",
);

const repos = makeRepos(db);
const pendingRepliesRepo = makePendingRepliesRepo(db);
const auditLog = makeAuditLogRepo(db);

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
const pendingReplies = makeSqlitePendingRepliesService(pendingRepliesRepo);
const credentialsStore = new SqliteCredentialsStore(db);

// Record startup in the audit log so we can confirm cold-start
// behaviour from historical data.
auditLog.record({
  eventType: "STARTUP",
  metadata: {
    nodeEnv: config.nodeEnv,
    migrationsApplied: migrationResult.applied.length,
  },
});

const deps: AppDeps = {
  config,
  repos,
  pendingRepliesRepo,
  auditLog,
  anonMessage,
  rateLimit,
  reportChannel,
  pendingReplies,
  credentialsStore,
  logger,
};

start(createApp(deps));
