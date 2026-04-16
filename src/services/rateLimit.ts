import type { RateLimitsRepo } from "../db/repos/rateLimitsRepo";
import type { TargetLimitsRepo } from "../db/repos/targetLimitsRepo";

export const RATE_LIMIT = 20;
export const RATE_WINDOW_SECS = 60;
export const TARGET_RATE_LIMIT = 10;
export const TARGET_RATE_WINDOW_SECS = 3600;

export interface RateLimitService {
  checkGlobal(workspaceId: string, userId: string, nowSec?: number): boolean;
  checkTarget(workspaceId: string, senderId: string, targetId: string, nowSec?: number): boolean;
}

export interface RateLimitDeps {
  rateLimits: RateLimitsRepo;
  targetLimits: TargetLimitsRepo;
  /**
   * M-9: required. Returns current unix seconds. Production wires
   * `() => Math.floor(Date.now() / 1000)` once in main.ts; tests inject
   * fixed or advancing clocks. Dropping the fallback makes it impossible
   * for a future test to silently read wall-clock time.
   */
  now: () => number;
}

export function makeRateLimitService(deps: RateLimitDeps): RateLimitService {
  const nowFn = deps.now;

  return {
    checkGlobal(workspaceId, userId, nowSec) {
      const now = nowSec ?? nowFn();
      return deps.rateLimits.checkAndIncrement(
        workspaceId,
        userId,
        now,
        RATE_LIMIT,
        RATE_WINDOW_SECS,
      );
    },

    checkTarget(workspaceId, senderId, targetId, nowSec) {
      const now = nowSec ?? nowFn();
      return deps.targetLimits.checkAndIncrement(
        workspaceId,
        senderId,
        targetId,
        now,
        TARGET_RATE_LIMIT,
        TARGET_RATE_WINDOW_SECS,
      );
    },
  };
}
