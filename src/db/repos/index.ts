import type Database from "better-sqlite3";
import { makeConversationsRepo, type ConversationsRepo } from "./conversationsRepo";
import { makeBlockedUsersRepo, type BlockedUsersRepo } from "./blockedUsersRepo";
import { makeRateLimitsRepo, type RateLimitsRepo } from "./rateLimitsRepo";
import { makeTargetLimitsRepo, type TargetLimitsRepo } from "./targetLimitsRepo";
import { makeConfigRepo, type ConfigRepo } from "./configRepo";

export interface Repos {
  conversations: ConversationsRepo;
  blockedUsers: BlockedUsersRepo;
  rateLimits: RateLimitsRepo;
  targetLimits: TargetLimitsRepo;
  config: ConfigRepo;
}

export function makeRepos(db: Database.Database): Repos {
  return {
    conversations: makeConversationsRepo(db),
    blockedUsers: makeBlockedUsersRepo(db),
    rateLimits: makeRateLimitsRepo(db),
    targetLimits: makeTargetLimitsRepo(db),
    config: makeConfigRepo(db),
  };
}

