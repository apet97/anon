import * as path from "path";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/migrator";
import { makeRepos } from "../../src/db/repos";
import { makePendingRepliesRepo } from "../../src/db/repos/pendingRepliesRepo";
import { makeAuditLogRepo } from "../../src/db/repos/auditLogRepo";
import { makeTestLogger, type TestLogger } from "./logger";
import { makeRateLimitService } from "../../src/services/rateLimit";
import { makeAnonMessageService } from "../../src/services/anonMessage";
import { makeReportChannelService } from "../../src/services/reportChannel";
import {
  makeInMemoryPendingRepliesService,
  makeSqlitePendingRepliesService,
} from "../../src/services/pendingReplies";
import { SqliteCredentialsStore } from "../../src/tokens/sqliteCredentialsStore";
import type { AppDeps } from "../../src/deps";
import type { AppConfig } from "../../src/config";
import type { Repos } from "../../src/db/repos";
import type { PendingRepliesService } from "../../src/services/pendingReplies";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

const TEST_CONFIG: AppConfig = Object.freeze({
  pumble: Object.freeze({
    appId: "test-app-id",
    appKey: "test-app-key",
    clientSecret: "test-client-secret",
    signingSecret: "test-signing-secret",
  }),
  databasePath: ":memory:",
  logLevel: "info",
  port: 3000,
  nodeEnv: "test",
}) as AppConfig;

export interface TestDeps extends AppDeps {
  logger: TestLogger;
  repos: Repos;
  pendingReplies: PendingRepliesService;
  db: Database.Database;
}

export interface MakeTestDepsOverrides {
  now?: () => number;
  pendingReplies?: PendingRepliesService;
  /**
   * By default, tests use the in-memory PendingRepliesService for
   * speed. Set this to true to use the SQLite-backed implementation
   * — required for any test that verifies persistence or purging.
   */
  useSqlitePendingReplies?: boolean;
}

export function makeTestDeps(overrides: MakeTestDepsOverrides = {}): TestDeps {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const pendingRepliesRepo = makePendingRepliesRepo(db);
  const auditLog = makeAuditLogRepo(db);
  const logger = makeTestLogger();
  const rateLimit = makeRateLimitService({
    rateLimits: repos.rateLimits,
    targetLimits: repos.targetLimits,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const anonMessage = makeAnonMessageService({
    conversations: repos.conversations,
    logger,
  });
  const reportChannel = makeReportChannelService({
    config: repos.config,
    logger,
  });
  const pendingReplies =
    overrides.pendingReplies ??
    (overrides.useSqlitePendingReplies
      ? makeSqlitePendingRepliesService(pendingRepliesRepo)
      : makeInMemoryPendingRepliesService());
  const credentialsStore = new SqliteCredentialsStore(db);
  return {
    db,
    version: "0.0.0-test",
    config: TEST_CONFIG,
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
}
