import type Database from "better-sqlite3";

export interface ConfigRepo {
  get(workspaceId: string, key: string): string | undefined;
  set(workspaceId: string, key: string, value: string): void;
  deleteForWorkspace(workspaceId: string): number;
}

export function makeConfigRepo(db: Database.Database): ConfigRepo {
  const getStmt = db.prepare("SELECT value FROM config WHERE workspace_id = ? AND key = ?");
  const setStmt = db.prepare(
    "INSERT OR REPLACE INTO config (workspace_id, key, value) VALUES (?, ?, ?)",
  );
  const deleteForWorkspaceStmt = db.prepare(
    "DELETE FROM config WHERE workspace_id = ?",
  );

  return {
    get(workspaceId, key) {
      const row = getStmt.get(workspaceId, key) as { value: string } | undefined;
      return row?.value;
    },
    set(workspaceId, key, value) {
      setStmt.run(workspaceId, key, value);
    },
    deleteForWorkspace(workspaceId) {
      return deleteForWorkspaceStmt.run(workspaceId).changes;
    },
  };
}
