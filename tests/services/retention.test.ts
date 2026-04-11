import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startRetentionScheduler } from "../../src/services/retention";

describe("startRetentionScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeStubs = () => {
    const auditLog = { purgeOlderThan: vi.fn((_n: number) => 1) };
    const conversations = { purgeOlderThan: vi.fn((_n: number) => 2) };
    const pendingReplies = { purgeOlderThan: vi.fn((_n: number) => 3) };
    const rateLimits = { purgeOlderThan: vi.fn((_n: number) => 4) };
    const targetLimits = { purgeOlderThan: vi.fn((_n: number) => 5) };
    const logger = { info: vi.fn() };
    return { auditLog, conversations, pendingReplies, rateLimits, targetLimits, logger };
  };

  it("purges all three repos at boot with the correct retention windows", () => {
    const stubs = makeStubs();
    const fixedNowMs = 1_700_000_000_000;
    const nowSec = Math.floor(fixedNowMs / 1000);
    const auditLogRetentionSec = 90 * 24 * 60 * 60;
    const conversationsRetentionSec = 90 * 24 * 60 * 60;
    const pendingRepliesRetentionSec = 24 * 60 * 60;

    const handle = startRetentionScheduler({
      ...stubs,
      now: () => fixedNowMs,
      intervalMs: 1000,
      auditLogRetentionSec,
      conversationsRetentionSec,
      pendingRepliesRetentionSec,
    });

    expect(stubs.auditLog.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(stubs.auditLog.purgeOlderThan).toHaveBeenCalledWith(
      nowSec - auditLogRetentionSec,
    );
    expect(stubs.conversations.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(stubs.conversations.purgeOlderThan).toHaveBeenCalledWith(
      nowSec - conversationsRetentionSec,
    );
    expect(stubs.pendingReplies.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(stubs.pendingReplies.purgeOlderThan).toHaveBeenCalledWith(
      nowSec - pendingRepliesRetentionSec,
    );
    expect(stubs.logger.info).toHaveBeenCalledTimes(1);
    expect(stubs.logger.info).toHaveBeenCalledWith(
      { audit_log: 1, conversations: 2, pending_replies: 3, rate_limits: 4, target_limits: 5 },
      "retention.purge",
    );

    handle.stop();
  });

  it("purges again after interval elapses", () => {
    const stubs = makeStubs();
    const intervalMs = 1000;

    const handle = startRetentionScheduler({
      ...stubs,
      now: () => 1_700_000_000_000,
      intervalMs,
    });

    expect(stubs.auditLog.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(stubs.conversations.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(stubs.pendingReplies.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(stubs.rateLimits.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(stubs.targetLimits.purgeOlderThan).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(intervalMs);

    expect(stubs.auditLog.purgeOlderThan).toHaveBeenCalledTimes(2);
    expect(stubs.conversations.purgeOlderThan).toHaveBeenCalledTimes(2);
    expect(stubs.pendingReplies.purgeOlderThan).toHaveBeenCalledTimes(2);
    expect(stubs.rateLimits.purgeOlderThan).toHaveBeenCalledTimes(2);
    expect(stubs.targetLimits.purgeOlderThan).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it("logs a single summary line per run with deletion counts", () => {
    const stubs = makeStubs();
    stubs.auditLog.purgeOlderThan.mockReturnValue(7);
    stubs.conversations.purgeOlderThan.mockReturnValue(11);
    stubs.pendingReplies.purgeOlderThan.mockReturnValue(13);

    const handle = startRetentionScheduler({
      ...stubs,
      now: () => 1_700_000_000_000,
      intervalMs: 1000,
    });

    expect(stubs.logger.info).toHaveBeenCalledTimes(1);
    const [payload, msg] = stubs.logger.info.mock.calls[0]!;
    expect(payload).toEqual({
      audit_log: 7,
      conversations: 11,
      pending_replies: 13,
      rate_limits: 4,
      target_limits: 5,
    });
    expect(msg).toBe("retention.purge");

    handle.stop();
  });
});
