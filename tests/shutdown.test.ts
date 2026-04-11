import { EventEmitter } from "events";
import { describe, it, expect, vi } from "vitest";
import { installShutdownHandlers } from "../src/shutdown";

const makeDeps = () => {
  const emitter = new EventEmitter();
  const retention = { stop: vi.fn() };
  const db = { close: vi.fn() } as unknown as import("better-sqlite3").Database;
  const logger = { info: vi.fn(), error: vi.fn() };
  const exit = vi.fn();
  const dispose = installShutdownHandlers({
    retention,
    db,
    logger,
    process: emitter,
    exit,
  });
  return { emitter, retention, db, logger, exit, dispose };
};

describe("installShutdownHandlers", () => {
  it("stops retention, closes db, and exits 0 on SIGTERM", () => {
    const { emitter, retention, db, logger, exit, dispose } = makeDeps();

    emitter.emit("SIGTERM");
    dispose();

    expect(retention.stop).toHaveBeenCalledTimes(1);
    expect((db as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith({ signal: "SIGTERM" }, "shutdown.begin");
    expect(logger.info).toHaveBeenCalledWith({ signal: "SIGTERM" }, "shutdown.end");
  });

  it("handles SIGINT identically", () => {
    const { emitter, retention, db, exit, dispose } = makeDeps();

    emitter.emit("SIGINT");
    dispose();

    expect(retention.stop).toHaveBeenCalledTimes(1);
    expect((db as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("is idempotent: a second signal does not double-close", () => {
    const { emitter, retention, db, exit, dispose } = makeDeps();

    emitter.emit("SIGTERM");
    emitter.emit("SIGTERM");
    emitter.emit("SIGINT");
    dispose();

    expect(retention.stop).toHaveBeenCalledTimes(1);
    expect((db as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("still closes db and exits 1 when retention.stop throws", () => {
    const emitter = new EventEmitter();
    const retention = {
      stop: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const db = { close: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const dispose = installShutdownHandlers({
      retention,
      db: db as unknown as import("better-sqlite3").Database,
      logger,
      process: emitter,
      exit,
    });

    emitter.emit("SIGTERM");
    dispose();

    expect(retention.stop).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
    // ok=false because retention.stop threw → exit(1)
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: "boom" },
      "shutdown.retention-stop-failed",
    );
  });

  it("still exits 1 when db.close throws", () => {
    const emitter = new EventEmitter();
    const retention = { stop: vi.fn() };
    const db = {
      close: vi.fn(() => {
        throw new Error("db-boom");
      }),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const dispose = installShutdownHandlers({
      retention,
      db: db as unknown as import("better-sqlite3").Database,
      logger,
      process: emitter,
      exit,
    });

    emitter.emit("SIGTERM");
    dispose();

    expect(retention.stop).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
    // ok=false because db.close threw → exit(1)
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: "db-boom" },
      "shutdown.db-close-failed",
    );
  });

  it("dispose() removes listeners so a second handler install does not double-fire", () => {
    const emitter = new EventEmitter();
    const retention = { stop: vi.fn() };
    const db = { close: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const dispose = installShutdownHandlers({
      retention,
      db: db as unknown as import("better-sqlite3").Database,
      logger,
      process: emitter,
      exit,
    });

    dispose();
    emitter.emit("SIGTERM");

    // After dispose, no handler fires.
    expect(exit).not.toHaveBeenCalled();
  });
});
