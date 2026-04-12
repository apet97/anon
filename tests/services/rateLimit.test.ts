import { describe, it, expect, beforeEach } from "vitest";
import {
  makeRateLimitService,
  RATE_LIMIT,
  RATE_WINDOW_SECS,
  TARGET_RATE_LIMIT,
  TARGET_RATE_WINDOW_SECS,
} from "../../src/services/rateLimit";
import { makeTestDb } from "../helpers/db";

const WS = "ws-1";

describe("rateLimit.checkGlobal", () => {
  let clockSec = 1_000_000;
  const now = () => clockSec;
  let svc: ReturnType<typeof makeRateLimitService>;
  let repos: ReturnType<typeof makeTestDb>["repos"];

  beforeEach(() => {
    const test = makeTestDb();
    repos = test.repos;
    clockSec = 1_000_000;
    svc = makeRateLimitService({
      rateLimits: repos.rateLimits,
      targetLimits: repos.targetLimits,
      now,
    });
  });

  it("allows the first call", () => {
    expect(svc.checkGlobal(WS, "u1")).toBe(true);
  });

  it(`allows exactly ${RATE_LIMIT} calls within the window`, () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect(svc.checkGlobal(WS, "u1")).toBe(true);
    }
    expect(svc.checkGlobal(WS, "u1")).toBe(false);
  });

  it("resets after the window expires", () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      svc.checkGlobal(WS, "u1");
    }
    expect(svc.checkGlobal(WS, "u1")).toBe(false);
    clockSec += RATE_WINDOW_SECS + 1;
    expect(svc.checkGlobal(WS, "u1")).toBe(true);
  });

  it("tracks each user independently", () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      svc.checkGlobal(WS, "u1");
    }
    expect(svc.checkGlobal(WS, "u1")).toBe(false);
    expect(svc.checkGlobal(WS, "u2")).toBe(true);
  });
});

describe("rateLimitsRepo.purgeOlderThan", () => {
  it("deletes rows whose window_start is before the cutoff", () => {
    const { repos } = makeTestDb();
    repos.rateLimits.reset(WS, "u1", 1000);
    repos.rateLimits.reset(WS, "u2", 2000);
    const deleted = repos.rateLimits.purgeOlderThan(1500);
    expect(deleted).toBe(1);
    expect(repos.rateLimits.get(WS, "u1")).toBeUndefined();
    expect(repos.rateLimits.get(WS, "u2")).toBeDefined();
  });
});

describe("targetLimitsRepo.purgeOlderThan", () => {
  it("deletes rows whose window_start is before the cutoff", () => {
    const { repos } = makeTestDb();
    repos.targetLimits.reset(WS, "s1", "t1", 1000);
    repos.targetLimits.reset(WS, "s1", "t2", 2000);
    const deleted = repos.targetLimits.purgeOlderThan(1500);
    expect(deleted).toBe(1);
    expect(repos.targetLimits.get(WS, "s1", "t1")).toBeUndefined();
    expect(repos.targetLimits.get(WS, "s1", "t2")).toBeDefined();
  });
});

describe("rateLimit.checkTarget", () => {
  let clockSec = 1_000_000;
  const now = () => clockSec;
  let svc: ReturnType<typeof makeRateLimitService>;
  let repos: ReturnType<typeof makeTestDb>["repos"];

  beforeEach(() => {
    const test = makeTestDb();
    repos = test.repos;
    clockSec = 1_000_000;
    svc = makeRateLimitService({
      rateLimits: repos.rateLimits,
      targetLimits: repos.targetLimits,
      now,
    });
  });

  it("allows the first call", () => {
    expect(svc.checkTarget(WS, "s1", "t1")).toBe(true);
  });

  it(`allows exactly ${TARGET_RATE_LIMIT} calls per (sender,target) within the window`, () => {
    for (let i = 0; i < TARGET_RATE_LIMIT; i += 1) {
      expect(svc.checkTarget(WS, "s1", "t1")).toBe(true);
    }
    expect(svc.checkTarget(WS, "s1", "t1")).toBe(false);
  });

  it("tracks distinct targets independently", () => {
    for (let i = 0; i < TARGET_RATE_LIMIT; i += 1) {
      svc.checkTarget(WS, "s1", "t1");
    }
    expect(svc.checkTarget(WS, "s1", "t1")).toBe(false);
    expect(svc.checkTarget(WS, "s1", "t2")).toBe(true);
  });

  it("resets after the 1h window expires", () => {
    for (let i = 0; i < TARGET_RATE_LIMIT; i += 1) {
      svc.checkTarget(WS, "s1", "t1");
    }
    expect(svc.checkTarget(WS, "s1", "t1")).toBe(false);
    clockSec += TARGET_RATE_WINDOW_SECS + 1;
    expect(svc.checkTarget(WS, "s1", "t1")).toBe(true);
  });
});
