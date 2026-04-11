import type { Logger } from "../../src/logger";

/**
 * Minimal pino-compatible logger for tests. Records every log call
 * so tests can assert what was logged and verify secrets are not
 * leaking.
 */
export interface LogEntry {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  obj: unknown;
  msg?: string;
}

export interface TestLogger extends Logger {
  entries: LogEntry[];
}

export function makeTestLogger(): TestLogger {
  const entries: LogEntry[] = [];
  const push = (level: LogEntry["level"]) => (obj: unknown, msg?: string) => {
    entries.push({ level, obj, ...(msg !== undefined ? { msg } : {}) });
  };
  const logger = {
    entries,
    trace: push("trace"),
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    fatal: push("fatal"),
    child: () => logger,
    level: "info",
  };
  return logger as unknown as TestLogger;
}
