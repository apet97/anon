import * as path from "path";
import { openInMemoryDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations/migrator";
import { makeRepos, type Repos } from "../../src/db/repos";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

export interface TestDb {
  db: Database.Database;
  repos: Repos;
}

export function makeTestDb(): TestDb {
  const db = openInMemoryDb();
  runMigrations(db, MIGRATIONS_DIR);
  const repos = makeRepos(db);
  return { db, repos };
}
