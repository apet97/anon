import { makeTestDb } from "./db";
import { makeTestLogger, type TestLogger } from "./logger";
import { makeRateLimitService } from "../../src/services/rateLimit";
import { makeAnonMessageService } from "../../src/services/anonMessage";
import { makeReportChannelService } from "../../src/services/reportChannel";
import { makeInMemoryPendingRepliesService } from "../../src/services/pendingReplies";
import type { AppDeps } from "../../src/deps";
import type { AppConfig } from "../../src/config";
import type { Repos } from "../../src/db/repos";
import type { PendingRepliesService } from "../../src/services/pendingReplies";

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
}

export interface MakeTestDepsOverrides {
  now?: () => number;
  pendingReplies?: PendingRepliesService;
}

export function makeTestDeps(overrides: MakeTestDepsOverrides = {}): TestDeps {
  const { repos } = makeTestDb();
  const logger = makeTestLogger();
  const rateLimit = makeRateLimitService({
    rateLimits: repos.rateLimits,
    targetLimits: repos.targetLimits,
    now: overrides.now,
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
    overrides.pendingReplies ?? makeInMemoryPendingRepliesService();
  return {
    config: TEST_CONFIG,
    repos,
    anonMessage,
    rateLimit,
    reportChannel,
    pendingReplies,
    logger,
  };
}
