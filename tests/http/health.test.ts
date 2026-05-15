import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/migrator";
import { registerHealthRoutes } from "../../src/http/health";
import { makeTestLogger } from "../helpers/logger";
import * as path from "path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

function makeHealthApp(db: Database.Database) {
  const app = express();
  registerHealthRoutes(app, {
    db,
    logger: makeTestLogger(),
    version: "0.0.0-test",
  });
  return app;
}

describe("GET /health", () => {
  it("returns 200 with status=ok when the DB is reachable", async () => {
    const db = new Database(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    const app = makeHealthApp(db);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db).toBe("ok");
    expect(res.body.version).toBe("0.0.0-test");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("returns 503 with status=error when the DB SELECT 1 throws", async () => {
    const db = {
      prepare: () => ({
        get: () => { throw new Error("db unavailable"); },
      }),
    } as unknown as Database.Database;
    const app = makeHealthApp(db);

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("error");
    expect(res.body.db).toBe("error");
  });
});

describe("GET /ready", () => {
  it("returns 200 with the same payload shape as /health", async () => {
    const db = new Database(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    const app = makeHealthApp(db);

    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db).toBe("ok");
  });
});
