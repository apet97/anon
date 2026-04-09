import type Database from "better-sqlite3";
import type { Express } from "express";
import type { Logger } from "../logger";

/**
 * Registers a `GET /health` endpoint on the Pumble SDK's internal
 * Express app, plus a `GET /ready` alias. The response reports:
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
 */

interface HealthDeps {
  db: Database.Database;
  logger: Logger;
  version: string;
}

const START_TIME = Date.now();

export function registerHealthRoutes(express: Express, deps: HealthDeps): void {
  const handler = (_req: unknown, res: any) => {
    let dbOk = false;
    try {
      deps.db.prepare("SELECT 1 AS ok").get();
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
      uptime: Math.round((Date.now() - START_TIME) / 1000),
    };
    res.status(dbOk ? 200 : 503).json(body);
  };

  express.get("/health", handler);
  express.get("/ready", handler);
}
