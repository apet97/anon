import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as path from "path";
import type { OAuth2AccessTokenResponse } from "pumble-sdk";
import { runMigrations } from "../../src/db/migrations/migrator";
import { SqliteCredentialsStore } from "../../src/tokens/sqliteCredentialsStore";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

describe("SqliteCredentialsStore", () => {
  let db: Database.Database;
  let store: SqliteCredentialsStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db, MIGRATIONS_DIR);
    store = new SqliteCredentialsStore(db);
  });

  it("initialize is a no-op and does not throw", async () => {
    await expect(store.initialize()).resolves.toBeUndefined();
  });

  it("saves and retrieves bot + user tokens from a single OAuth response", async () => {
    await store.saveTokens({
      workspaceId: "ws-1",
      userId: "user-1",
      botId: "bot-1",
      accessToken: "user-jwt",
      botToken: "bot-jwt",
    });

    expect(await store.getBotToken("ws-1")).toBe("bot-jwt");
    expect(await store.getBotUserId("ws-1")).toBe("bot-1");
    expect(await store.getUserToken("ws-1", "user-1")).toBe("user-jwt");
    expect(await store.getUserToken("ws-1", "unknown")).toBeUndefined();
    expect(await store.getBotToken("ws-unknown")).toBeUndefined();
  });

  it("saveTokens is an upsert — later calls overwrite earlier tokens", async () => {
    await store.saveTokens({
      workspaceId: "ws-1",
      userId: "user-1",
      botId: "bot-1",
      accessToken: "old-user",
      botToken: "old-bot",
    });
    await store.saveTokens({
      workspaceId: "ws-1",
      userId: "user-1",
      botId: "bot-1",
      accessToken: "new-user",
      botToken: "new-bot",
    });
    expect(await store.getUserToken("ws-1", "user-1")).toBe("new-user");
    expect(await store.getBotToken("ws-1")).toBe("new-bot");
  });

  it("deleteForUser only removes the user row, leaving bot token intact", async () => {
    await store.saveTokens({
      workspaceId: "ws-1",
      userId: "user-1",
      botId: "bot-1",
      accessToken: "u",
      botToken: "b",
    });
    await store.deleteForUser("user-1", "ws-1");
    expect(await store.getUserToken("ws-1", "user-1")).toBeUndefined();
    expect(await store.getBotToken("ws-1")).toBe("b");
  });

  it("deleteForWorkspace removes every row for that workspace", async () => {
    await store.saveTokens({
      workspaceId: "ws-1",
      userId: "user-1",
      botId: "bot-1",
      accessToken: "u",
      botToken: "b",
    });
    await store.saveTokens({
      workspaceId: "ws-2",
      userId: "user-2",
      botId: "bot-2",
      accessToken: "u2",
      botToken: "b2",
    });
    await store.deleteForWorkspace("ws-1");
    expect(await store.getBotToken("ws-1")).toBeUndefined();
    expect(await store.getUserToken("ws-1", "user-1")).toBeUndefined();
    // ws-2 untouched
    expect(await store.getBotToken("ws-2")).toBe("b2");
    expect(await store.getUserToken("ws-2", "user-2")).toBe("u2");
  });

  it("handles OAuth responses without a botToken", async () => {
    await store.saveTokens({
      workspaceId: "ws-1",
      userId: "user-1",
      accessToken: "user-jwt",
    });
    expect(await store.getUserToken("ws-1", "user-1")).toBe("user-jwt");
    expect(await store.getBotToken("ws-1")).toBeUndefined();
  });

  it("handles OAuth responses without a userId", async () => {
    // Bot-only OAuth installs omit userId/accessToken. The type
    // requires both, so cast through unknown to model the runtime
    // shape without violating strict TS in the rest of the test.
    const botOnly = {
      workspaceId: "ws-1",
      botId: "bot-1",
      botToken: "xpat-" + "a".repeat(32),
    } as unknown as OAuth2AccessTokenResponse;
    await expect(store.saveTokens(botOnly)).resolves.toBeUndefined();
    expect(await store.getBotToken("ws-1")).toBe("xpat-" + "a".repeat(32));
    expect(await store.getUserToken("ws-1", "any-user")).toBeUndefined();
  });
});
