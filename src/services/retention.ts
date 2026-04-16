/**
 * Retention scheduler: enforces SPEC §6.3 data-retention windows by
 * periodically purging stale rows from time-scoped tables.
 *
 * Windows:
 * - `audit_log` / `conversations`: 90 days (per SPEC §6.3).
 * - `pending_replies`: 24 hours.
 * - `rate_limits` / `target_limits`: purge expired windows so the
 *   tables don't grow unbounded. Any row whose window_start is older
 *   than its window duration is expired and safe to delete.
 */

export interface RetentionDeps {
  auditLog: { purgeOlderThan: (unixSec: number) => number };
  conversations: { purgeOlderThan: (unixSec: number) => number };
  pendingReplies: { purgeOlderThan: (unixSec: number) => number };
  rateLimits: { purgeOlderThan: (unixSec: number) => number };
  targetLimits: { purgeOlderThan: (unixSec: number) => number };
  logger: {
    info: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  };
  /**
   * M-9: required. Returns current unix milliseconds. Production wires
   * `() => Date.now()` once in main.ts; tests inject fake clocks.
   */
  now: () => number;
  intervalMs?: number;
  auditLogRetentionSec?: number;
  conversationsRetentionSec?: number;
  pendingRepliesRetentionSec?: number;
  rateLimitsRetentionSec?: number;
  targetLimitsRetentionSec?: number;
}

export interface RetentionHandle {
  stop: () => void;
}

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_NINETY_DAYS_SEC = 90 * 24 * 60 * 60;
const DEFAULT_TWENTY_FOUR_HOURS_SEC = 24 * 60 * 60;
const DEFAULT_RATE_LIMITS_RETENTION_SEC = 60;      // global window: 60s
const DEFAULT_TARGET_LIMITS_RETENTION_SEC = 3600;  // per-pair window: 1h

export function startRetentionScheduler(deps: RetentionDeps): RetentionHandle {
  const now = deps.now;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const auditLogRetentionSec =
    deps.auditLogRetentionSec ?? DEFAULT_NINETY_DAYS_SEC;
  const conversationsRetentionSec =
    deps.conversationsRetentionSec ?? DEFAULT_NINETY_DAYS_SEC;
  const pendingRepliesRetentionSec =
    deps.pendingRepliesRetentionSec ?? DEFAULT_TWENTY_FOUR_HOURS_SEC;
  const rateLimitsRetentionSec =
    deps.rateLimitsRetentionSec ?? DEFAULT_RATE_LIMITS_RETENTION_SEC;
  const targetLimitsRetentionSec =
    deps.targetLimitsRetentionSec ?? DEFAULT_TARGET_LIMITS_RETENTION_SEC;

  // H-4: a DB hiccup in any of the five purge calls must not crash the
  // scheduler or skip future ticks. Wrap in try/catch and guard against
  // re-entrant runs so a slow purge can't overlap with the next interval.
  let isRunning = false;
  const runOnce = (): void => {
    if (isRunning) {
      deps.logger.info(
        { skipped: "previous run still in flight" },
        "retention.skip",
      );
      return;
    }
    isRunning = true;
    try {
      const nowSec = Math.floor(now() / 1000);
      const auditLogDeleted = deps.auditLog.purgeOlderThan(
        nowSec - auditLogRetentionSec,
      );
      const conversationsDeleted = deps.conversations.purgeOlderThan(
        nowSec - conversationsRetentionSec,
      );
      const pendingRepliesDeleted = deps.pendingReplies.purgeOlderThan(
        nowSec - pendingRepliesRetentionSec,
      );
      const rateLimitsDeleted = deps.rateLimits.purgeOlderThan(
        nowSec - rateLimitsRetentionSec,
      );
      const targetLimitsDeleted = deps.targetLimits.purgeOlderThan(
        nowSec - targetLimitsRetentionSec,
      );
      deps.logger.info(
        {
          audit_log: auditLogDeleted,
          conversations: conversationsDeleted,
          pending_replies: pendingRepliesDeleted,
          rate_limits: rateLimitsDeleted,
          target_limits: targetLimitsDeleted,
        },
        "retention.purge",
      );
    } catch (err) {
      deps.logger.error(
        { err: (err as Error).message },
        "retention.purge failed",
      );
    } finally {
      isRunning = false;
    }
  };

  runOnce();

  const handle: ReturnType<typeof setInterval> = setInterval(
    runOnce,
    intervalMs,
  );
  try {
    (handle as { unref?: () => void }).unref?.();
  } catch {
    // Non-Node runtimes may not implement unref; ignore.
  }

  return {
    stop: () => clearInterval(handle),
  };
}
