import { describe, it, expect, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { openDb } from "../../src/db/connection";

describe("openDb", () => {
  let db: Database.Database | undefined;
  let tmpPath: string | undefined;

  afterEach(() => {
    db?.close();
    if (tmpPath) {
      for (const ext of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(tmpPath + ext);
        } catch {
          /* sidecar may not exist */
        }
      }
    }
    db = undefined;
    tmpPath = undefined;
  });

  it("sets journal_mode to WAL", () => {
    tmpPath = path.join(os.tmpdir(), `anon-conn-test-${Date.now()}-${Math.random()}.db`);
    db = openDb(tmpPath);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("sets busy_timeout to 5000", () => {
    tmpPath = path.join(os.tmpdir(), `anon-conn-test-${Date.now()}-${Math.random()}.db`);
    db = openDb(tmpPath);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("enables foreign keys", () => {
    tmpPath = path.join(os.tmpdir(), `anon-conn-test-${Date.now()}-${Math.random()}.db`);
    db = openDb(tmpPath);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
