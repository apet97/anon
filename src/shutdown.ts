import type Database from "better-sqlite3";
import type { EventEmitter } from "events";
import type { RetentionHandle } from "./services/retention";

export interface ShutdownDeps {
  retention: RetentionHandle;
  db: Database.Database;
  logger: {
    info: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  };
  // Test seams — default to real process + process.exit when omitted.
  process?: Pick<EventEmitter, "on" | "removeAllListeners">;
  exit?: (code: number) => void;
}

/**
 * Register SIGTERM/SIGINT shutdown handlers. Returns a dispose function
 * that removes the listeners — useful in tests to prevent handler leaks.
 *
 * NOTE: The Pumble SDK (v1.1.1) does not expose an HTTP server handle.
 * Draining in-flight webhook requests before DB close is not currently
 * possible without SDK support. If the SDK adds stop()/close() on Addon,
 * accept that handle here and call it before db.close().
 */
export function installShutdownHandlers(deps: ShutdownDeps): () => void {
  const proc = deps.process ?? process;
  const exit = deps.exit ?? ((code: number): void => process.exit(code));
  let shuttingDown = false;

  const handler = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    let ok = true;

    deps.logger.info({ signal }, "shutdown.begin");

    // Watchdog: if shutdown hangs for any reason, force-exit after 10 s.
    const watchdog = setTimeout(() => exit(1), 10_000);
    if (typeof (watchdog as NodeJS.Timeout).unref === "function") {
      (watchdog as NodeJS.Timeout).unref();
    }

    try {
      deps.retention.stop();
    } catch (err) {
      ok = false;
      deps.logger.error(
        { err: (err as Error).message },
        "shutdown.retention-stop-failed",
      );
    }
    try {
      deps.db.close();
    } catch (err) {
      ok = false;
      deps.logger.error(
        { err: (err as Error).message },
        "shutdown.db-close-failed",
      );
    }

    clearTimeout(watchdog);
    deps.logger.info({ signal }, "shutdown.end");
    exit(ok ? 0 : 1);
  };

  proc.on("SIGTERM", () => handler("SIGTERM"));
  proc.on("SIGINT", () => handler("SIGINT"));

  return (): void => {
    proc.removeAllListeners("SIGTERM");
    proc.removeAllListeners("SIGINT");
  };
}
