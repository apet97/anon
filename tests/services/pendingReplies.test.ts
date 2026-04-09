import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as path from "path";
import { runMigrations } from "../../src/db/migrations/migrator";
import { makePendingRepliesRepo } from "../../src/db/repos/pendingRepliesRepo";
import { makeSqlitePendingRepliesService } from "../../src/services/pendingReplies";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

function openMigratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe("SQLite-backed PendingRepliesService", () => {
  it("round-trips a set -> get -> delete cycle", async () => {
    const db = openMigratedDb();
    const svc = makeSqlitePendingRepliesService(makePendingRepliesRepo(db));
    await svc.set("ws-1", "u1", { convId: "c1", direction: "recipient" });
    expect(await svc.get("ws-1", "u1")).toEqual({
      convId: "c1",
      direction: "recipient",
    });
    await svc.delete("ws-1", "u1");
    expect(await svc.get("ws-1", "u1")).toBeUndefined();
  });

  it("survives a simulated process restart", async () => {
    // Simulate a shared file-backed database by serialising then
    // reopening. We use the same file path for both connections.
    const tmpFile = `/tmp/anon-test-pending-${Date.now()}-${Math.random()}.db`;
    const firstDb = new Database(tmpFile);
    firstDb.pragma("foreign_keys = ON");
    runMigrations(firstDb, MIGRATIONS_DIR);
    const first = makeSqlitePendingRepliesService(
      makePendingRepliesRepo(firstDb),
    );
    await first.set("ws-1", "u1", { convId: "c1", direction: "recipient" });
    firstDb.close();

    // "Restart": reopen the same database file
    const secondDb = new Database(tmpFile);
    secondDb.pragma("foreign_keys = ON");
    const second = makeSqlitePendingRepliesService(
      makePendingRepliesRepo(secondDb),
    );
    const pending = await second.get("ws-1", "u1");
    expect(pending).toEqual({ convId: "c1", direction: "recipient" });
    secondDb.close();
    // Cleanup
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("fs").unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it("upsert overwrites the existing row for the same user", async () => {
    const db = openMigratedDb();
    const svc = makeSqlitePendingRepliesService(makePendingRepliesRepo(db));
    await svc.set("ws-1", "u1", { convId: "c1", direction: "recipient" });
    await svc.set("ws-1", "u1", { convId: "c2", direction: "sender" });
    expect(await svc.get("ws-1", "u1")).toEqual({
      convId: "c2",
      direction: "sender",
    });
  });

  it("keeps each workspace+user pair isolated", async () => {
    const db = openMigratedDb();
    const svc = makeSqlitePendingRepliesService(makePendingRepliesRepo(db));
    await svc.set("ws-1", "u1", { convId: "c1", direction: "recipient" });
    await svc.set("ws-2", "u1", { convId: "c2", direction: "sender" });
    expect((await svc.get("ws-1", "u1"))?.convId).toBe("c1");
    expect((await svc.get("ws-2", "u1"))?.convId).toBe("c2");
  });
});
