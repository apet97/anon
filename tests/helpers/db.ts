import { openInMemoryDb } from "../../src/db/connection";
import { makeRepos, type Repos } from "../../src/db/repos";
import type Database from "better-sqlite3";

export interface TestDb {
  db: Database.Database;
  repos: Repos;
}

/**
 * Build a fresh in-memory SQLite database with the initial schema
 * and the full repo set. Every call returns an independent database.
 */
export function makeTestDb(): TestDb {
  const db = openInMemoryDb();
  const repos = makeRepos(db);
  return { db, repos };
}
