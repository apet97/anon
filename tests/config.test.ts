import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config";

const REQUIRED = [
  "PUMBLE_APP_ID",
  "PUMBLE_APP_KEY",
  "PUMBLE_APP_CLIENT_SECRET",
  "PUMBLE_APP_SIGNING_SECRET",
];

function clear() {
  for (const k of REQUIRED) delete process.env[k];
  delete process.env.DATABASE_PATH;
  delete process.env.LOG_LEVEL;
  delete process.env.PORT;
  delete process.env.NODE_ENV;
}

function populate() {
  // Use correctly-formatted fake secrets so format validation passes.
  process.env.PUMBLE_APP_ID = "a".repeat(24);
  process.env.PUMBLE_APP_KEY = "xpat-" + "a".repeat(32);
  process.env.PUMBLE_APP_CLIENT_SECRET = "xpcls-" + "a".repeat(32);
  process.env.PUMBLE_APP_SIGNING_SECRET = "xpss-" + "a".repeat(32);
}

describe("loadConfig", () => {
  beforeEach(clear);
  afterEach(clear);

  it("fails fast when any required secret is missing", () => {
    populate();
    delete process.env.PUMBLE_APP_SIGNING_SECRET;
    expect(() => loadConfig()).toThrow(/PUMBLE_APP_SIGNING_SECRET/);
  });

  it("fails fast when a required secret is empty", () => {
    populate();
    process.env.PUMBLE_APP_ID = "   ";
    expect(() => loadConfig()).toThrow(/PUMBLE_APP_ID/);
  });

  it("applies defaults for optional vars", () => {
    populate();
    const cfg = loadConfig();
    expect(cfg.databasePath).toBe("./data/anon.db");
    expect(cfg.logLevel).toBe("info");
    expect(cfg.port).toBe(3000);
    expect(cfg.nodeEnv).toBe("development");
  });

  it("rejects invalid PORT", () => {
    populate();
    process.env.PORT = "not-a-port";
    expect(() => loadConfig()).toThrow(/PORT/);
  });

  it("rejects invalid LOG_LEVEL", () => {
    populate();
    process.env.LOG_LEVEL = "loud";
    expect(() => loadConfig()).toThrow(/LOG_LEVEL/);
  });

  it("returns a frozen object", () => {
    populate();
    const cfg = loadConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.pumble)).toBe(true);
  });
});
