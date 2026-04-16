import * as path from "path";
import { start } from "pumble-sdk";
import { loadConfig } from "./config";
import { openDb } from "./db/connection";
import { getAppliedVersions } from "./db/migrations/migrator";
import { makeRepos } from "./db/repos";
import { makePendingRepliesRepo } from "./db/repos/pendingRepliesRepo";
import { makeAuditLogRepo } from "./db/repos/auditLogRepo";
import { makeLogger } from "./logger";
import { makeRateLimitService } from "./services/rateLimit";
import { makeAnonMessageService } from "./services/anonMessage";
import { makeReportChannelService } from "./services/reportChannel";
import { makeSqlitePendingRepliesService } from "./services/pendingReplies";
import { startRetentionScheduler } from "./services/retention";
import { installShutdownHandlers } from "./shutdown";
import { SqliteCredentialsStore } from "./tokens/sqliteCredentialsStore";
import { createApp } from "./app";
import type { AppDeps } from "./deps";
import pkg from "../package.json";

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

// Register unhandled-rejection and uncaught-exception handlers as the very
// first step so any crash during bootstrap is logged structurally.
// These fire BEFORE `main()` initialises the pino logger, so we fall back
// to a plain console.error for those edge cases.
process.on("unhandledRejection", (reason) => {
  console.error({ reason }, "unhandledRejection");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error({ err: err.message, stack: err.stack }, "uncaughtException");
  process.exit(1);
});

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = makeLogger({
    level: config.logLevel,
    prettyPrint: config.nodeEnv === "development",
  });

  // Re-register rejection handler now that pino is available.
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandledRejection");
    process.exit(1);
  });
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException");
    process.exit(1);
  });

  try {
    logger.info(
      { nodeEnv: config.nodeEnv, port: config.port, dbPath: config.databasePath },
      "anon bootstrap",
    );

    // openDb now runs the migrator itself (finding M-8); no separate call.
    const migrationsDir = path.resolve(__dirname, "db/migrations");
    const db = openDb(config.databasePath, migrationsDir);
    logger.info({ migrationsDir }, "database opened");

    const repos = makeRepos(db);
    const pendingRepliesRepo = makePendingRepliesRepo(db);
    const auditLog = makeAuditLogRepo(db, logger);

    // M-9: `now` is required on both services so a future test can't
    // silently fall back to wall-clock time. Production wires Date.now here
    // once (rateLimit expects seconds, retention expects milliseconds).
    const rateLimit = makeRateLimitService({
      rateLimits: repos.rateLimits,
      targetLimits: repos.targetLimits,
      now: () => Math.floor(Date.now() / 1000),
    });
    const anonMessage = makeAnonMessageService({ logger });
    const reportChannel = makeReportChannelService({
      config: repos.config,
      logger,
      auditLog,
    });
    const pendingReplies = makeSqlitePendingRepliesService(pendingRepliesRepo);
    const credentialsStore = new SqliteCredentialsStore(db);

    // Record startup in the audit log so we can confirm cold-start
    // behaviour from historical data.
    const appliedVersions = getAppliedVersions(db);
    auditLog.record({
      eventType: "STARTUP",
      metadata: {
        nodeEnv: config.nodeEnv,
        schemaVersions: appliedVersions,
      },
    });

    // Kick off periodic retention purges. The handle is captured so the
    // SIGTERM/SIGINT path below can stop the interval cleanly.
    // M-9: `now` is required; wall-clock ms.
    const retention = startRetentionScheduler({
      auditLog,
      conversations: repos.conversations,
      pendingReplies: pendingRepliesRepo,
      rateLimits: repos.rateLimits,
      targetLimits: repos.targetLimits,
      logger,
      now: () => Date.now(),
    });

    installShutdownHandlers({ retention, db, logger });

    const deps: AppDeps = {
      config,
      db,
      version: pkg.version ?? "0.0.0",
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

    await start(createApp(deps));
  } catch (err) {
    // Any synchronous or async bootstrap failure is caught here and logged
    // with full structure before a clean exit(1).
    console.error({ err }, "bootstrap.failed");
    process.exit(1);
  }
}

void main();
