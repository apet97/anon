import type { Request, Response, Express } from "express";
import type Database from "better-sqlite3";
import type { Logger } from "../logger";

/**
 * Registers a `GET /health` endpoint on the Pumble SDK's internal
 * Express app. The response reports:
 *
 *   {
 *     "status": "ok" | "error",
 *     "db": "ok" | "error",
 *     "version": "<package.json version>",
 *     "uptime": <seconds>
 *   }
 *
 * The DB check is a cheap `SELECT 1`. A failing DB responds 503 so
 * orchestrators (Kubernetes, Railway, fly.io) can restart the pod.
 *
 * `/health`  — liveness probe (is the process alive?)
 * `/ready`   — readiness probe (can it serve traffic?)
 * Both return the same payload for now; split them if a deeper
 * readiness check is added (e.g. credentials-store reachability).
 */

interface HealthDeps {
  db: Database.Database;
  logger: Logger;
  version: string;
}

export function registerHealthRoutes(express: Express, deps: HealthDeps): void {
  // Hoist the prepared statement so it is compiled once and reused on every
  // probe — db.prepare() is not free and would block the event loop per call.
  const checkStmt = deps.db.prepare("SELECT 1 AS ok");

  const handler = (_req: Request, res: Response): void => {
    let dbOk = false;
    try {
      checkStmt.get();
      dbOk = true;
    } catch (err) {
      deps.logger.error(
        { err: (err as Error).message, outcome: "db-check-failed" },
        "health check: db unreachable",
      );
    }
    const body = {
      status: dbOk ? "ok" : "error",
      db: dbOk ? "ok" : "error",
      version: deps.version,
      // process.uptime() is the authoritative uptime — not wall-clock-based.
      uptime: Math.round(process.uptime()),
    };
    res.status(dbOk ? 200 : 503).json(body);
  };

  express.get("/health", handler);
  express.get("/ready", handler);
  express.get("/", (_req, res) => {
    res.redirect("https://github.com/apet97/anon");
  });
}
