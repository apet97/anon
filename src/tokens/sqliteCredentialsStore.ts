import type Database from "better-sqlite3";
import type { CredentialsStore, OAuth2AccessTokenResponse } from "pumble-sdk";

/**
 * SQLite-backed implementation of the 7-method Pumble
 * {@link CredentialsStore} contract.
 *
 * Row layout (see src/db/migrations/004_tokens.sql):
 *
 *   - Bot tokens:   token_kind='bot', workspace_user_id='' (sentinel),
 *     bot_user_id set to the bot's workspace user id, access_token
 *     set to the bot JWT.
 *
 *   - User tokens:  token_kind='user', workspace_user_id=<user>,
 *     access_token set to the user JWT. bot_user_id is nullable but
 *     we mirror the bot row value to keep queries cheap.
 *
 * The primary key (workspace_id, workspace_user_id, token_kind) is
 * deterministic so `saveTokens` can use plain UPSERTs in a single
 * transaction for the bot + user rows delivered by the Pumble OAuth
 * token exchange.
 */
export class SqliteCredentialsStore implements CredentialsStore {
  private readonly db: Database.Database;
  private readonly selectBotTokenStmt: Database.Statement;
  private readonly selectBotUserIdStmt: Database.Statement;
  private readonly selectUserTokenStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteWorkspaceStmt: Database.Statement;
  private readonly deleteUserStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.selectBotTokenStmt = db.prepare(
      "SELECT access_token FROM tokens WHERE workspace_id = ? AND token_kind = 'bot'",
    );
    this.selectBotUserIdStmt = db.prepare(
      "SELECT bot_user_id FROM tokens WHERE workspace_id = ? AND token_kind = 'bot'",
    );
    this.selectUserTokenStmt = db.prepare(
      "SELECT access_token FROM tokens WHERE workspace_id = ? AND workspace_user_id = ? AND token_kind = 'user'",
    );
    this.upsertStmt = db.prepare(
      "INSERT INTO tokens (workspace_id, workspace_user_id, token_kind, bot_user_id, access_token) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(workspace_id, workspace_user_id, token_kind) DO UPDATE SET " +
        "  bot_user_id = excluded.bot_user_id, " +
        "  access_token = excluded.access_token, " +
        "  updated_at = unixepoch()",
    );
    this.deleteWorkspaceStmt = db.prepare(
      "DELETE FROM tokens WHERE workspace_id = ?",
    );
    this.deleteUserStmt = db.prepare(
      "DELETE FROM tokens WHERE workspace_id = ? AND workspace_user_id = ? AND token_kind = 'user'",
    );
  }

  async initialize(): Promise<void> {
    // The migrator creates the table; nothing to do here. Kept to
    // honour the CredentialsStore contract.
  }

  async getBotToken(workspaceId: string): Promise<string | undefined> {
    const row = this.selectBotTokenStmt.get(workspaceId) as
      | { access_token: string }
      | undefined;
    return row?.access_token;
  }

  async getBotUserId(workspaceId: string): Promise<string | undefined> {
    const row = this.selectBotUserIdStmt.get(workspaceId) as
      | { bot_user_id: string | null }
      | undefined;
    return row?.bot_user_id ?? undefined;
  }

  async getUserToken(
    workspaceId: string,
    workspaceUserId: string,
  ): Promise<string | undefined> {
    const row = this.selectUserTokenStmt.get(workspaceId, workspaceUserId) as
      | { access_token: string }
      | undefined;
    return row?.access_token;
  }

  async saveTokens(response: OAuth2AccessTokenResponse): Promise<void> {
    const upsert = this.upsertStmt;
    const tx = this.db.transaction(() => {
      // Bot row uses the empty-string sentinel for workspace_user_id
      // so the PK stays well-defined.
      if (response.botToken) {
        upsert.run(
          response.workspaceId,
          "",
          "bot",
          response.botId ?? null,
          response.botToken,
        );
      }
      if (response.userId) {
        upsert.run(
          response.workspaceId,
          response.userId,
          "user",
          response.botId ?? null,
          response.accessToken,
        );
      }
    });
    tx();
  }

  async deleteForWorkspace(workspaceId: string): Promise<void> {
    this.deleteWorkspaceStmt.run(workspaceId);
  }

  async deleteForUser(
    workspaceUserId: string,
    workspaceId: string,
  ): Promise<void> {
    this.deleteUserStmt.run(workspaceId, workspaceUserId);
  }
}
