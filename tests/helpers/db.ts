import * as path from "path";
import { openInMemoryDb } from "../../src/db/connection";
import { makeRepos, type Repos } from "../../src/db/repos";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

export interface TestDb {
  db: Database.Database;
  repos: Repos;
}

export function makeTestDb(): TestDb {
  // M-8: openInMemoryDb runs the migrator itself now. We pass the src
  // migrations dir explicitly because the test runs from source without
  // going through the dist/ copy.
  const db = openInMemoryDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  return { db, repos };
}
