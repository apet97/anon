import type Database from "better-sqlite3";

export interface ConfigRepo {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function makeConfigRepo(db: Database.Database): ConfigRepo {
  const getStmt = db.prepare("SELECT value FROM config WHERE key = ?");
  const setStmt = db.prepare(
    "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
  );

  return {
    get(key) {
      const row = getStmt.get(key) as { value: string } | undefined;
      return row?.value;
    },
    set(key, value) {
      setStmt.run(key, value);
    },
  };
}
