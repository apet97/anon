import type { RateLimitsRepo } from "../db/repos/rateLimitsRepo";
import type { TargetLimitsRepo } from "../db/repos/targetLimitsRepo";

/**
 * Rate-limit semantics are preserved exactly from the 0.0.29
 * prototype, because the PRD abuse model depends on them:
 * - Global:   5 messages per sender per 60s window
 * - Per pair: 2 messages per (sender, recipient) per 3600s window
 *
 * Both are fixed-window counters. When a request arrives after the
 * window expired, the counter resets to 1 and the request is
 * allowed. When the counter is already at the limit inside the
 * current window, the request is rejected.
 *
 * `nowSec` is injected so tests can drive the clock directly.
 */
export const RATE_LIMIT = 5;
export const RATE_WINDOW_SECS = 60;
export const TARGET_RATE_LIMIT = 2;
export const TARGET_RATE_WINDOW_SECS = 3600;

export interface RateLimitService {
  checkGlobal(userId: string, nowSec?: number): boolean;
  checkTarget(senderId: string, targetId: string, nowSec?: number): boolean;
}

export interface RateLimitDeps {
  rateLimits: RateLimitsRepo;
  targetLimits: TargetLimitsRepo;
  now?: () => number;
}

export function makeRateLimitService(deps: RateLimitDeps): RateLimitService {
  const nowFn = deps.now ?? (() => Math.floor(Date.now() / 1000));

  return {
    checkGlobal(userId, nowSec) {
      const now = nowSec ?? nowFn();
      const row = deps.rateLimits.get(userId);

      if (!row || now - row.window_start > RATE_WINDOW_SECS) {
        deps.rateLimits.reset(userId, now);
        return true;
      }

      if (row.msg_count >= RATE_LIMIT) return false;

      deps.rateLimits.increment(userId);
      return true;
    },

    checkTarget(senderId, targetId, nowSec) {
      const now = nowSec ?? nowFn();
      const row = deps.targetLimits.get(senderId, targetId);

      if (!row || now - row.window_start > TARGET_RATE_WINDOW_SECS) {
        deps.targetLimits.reset(senderId, targetId, now);
        return true;
      }

      if (row.msg_count >= TARGET_RATE_LIMIT) return false;

      deps.targetLimits.increment(senderId, targetId);
      return true;
    },
  };
}
