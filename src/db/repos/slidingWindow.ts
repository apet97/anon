/**
 * Sliding-window rate-limit state machine shared by the
 * rate_limits and target_limits repos. Both repos store a row with
 * a running message count and the unix-second timestamp of the
 * window start; the state machine below is identical between them
 * once the composite-key parameters are bound into getters and
 * mutators by the caller.
 *
 * Call this from inside a `db.transaction(...)` so the read/write
 * pair is atomic — the sqlite driver guarantees that the getter
 * and the mutator run as one logical unit.
 */

export interface SlidingWindowRow {
  msg_count: number;
  window_start: number;
}

export function checkAndIncrementSlidingWindow(
  getRow: () => SlidingWindowRow | undefined,
  reset: (now: number) => void,
  increment: () => void,
  now: number,
  limit: number,
  windowSecs: number,
): boolean {
  const row = getRow();
  if (!row || now - row.window_start > windowSecs) {
    reset(now);
    return true;
  }
  if (row.msg_count >= limit) return false;
  increment();
  return true;
}
