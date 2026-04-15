import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as path from "path";
import { makeAnonCommand } from "../src/commands/anon";
import { makeAnonBlockCommand } from "../src/commands/anonBlock";
import { makeAnonUnblockCommand } from "../src/commands/anonUnblock";
import { makeReportAnonHandler } from "../src/interactions/reportAnon";
import { makeTestDeps } from "./helpers/deps";
import { makeTestLogger } from "./helpers/logger";
import { makeSlashCommandCtx, makeBlockInteractionCtx } from "./helpers/ctx";
import { makeFakePumbleClient } from "./helpers/pumbleClient";
import { REPORT_CHANNEL_CONFIG_KEY } from "../src/services/reportChannel";
import { makeAuditLogRepo } from "../src/db/repos/auditLogRepo";
import { runMigrations } from "../src/db/migrations/migrator";

const MIGRATIONS_DIR = path.resolve(__dirname, "../src/db/migrations");

describe("audit log coverage for sensitive events", () => {
  it("records a SEND entry on /anon success", async () => {
    const deps = makeTestDeps();
    const client = makeFakePumbleClient();
    const handler = makeAnonCommand(deps).handler;
    const ctx = makeSlashCommandCtx({
      userId: "sender-1",
      text: "<<@recipient-1>> hi",
      botClient: client,
    });
    await handler(ctx as any);
    const rows = deps.auditLog.listRecent(10);
    expect(rows.some((r) => r.event_type === "SEND")).toBe(true);
    const sendRow = rows.find((r) => r.event_type === "SEND")!;
    expect(sendRow.actor_id).toBe("sender-1");
    expect(sendRow.target_id).toBe("recipient-1");
    // Message body is NEVER in the audit row — only IDs + outcome
    expect(sendRow.metadata_json).not.toContain("hi");
  });

  it("records BLOCK and UNBLOCK entries", async () => {
    const deps = makeTestDeps();
    await makeAnonBlockCommand(deps).handler(
      makeSlashCommandCtx({ userId: "u1", text: "" }) as any,
    );
    await makeAnonUnblockCommand(deps).handler(
      makeSlashCommandCtx({ userId: "u1", text: "" }) as any,
    );
    const rows = deps.auditLog.listRecent(10).map((r) => r.event_type);
    expect(rows).toContain("BLOCK");
    expect(rows).toContain("UNBLOCK");
  });

  it("records a REPORT entry on abuse report", async () => {
    const deps = makeTestDeps();
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1", "private content");
    deps.repos.config.set("ws-1", REPORT_CHANNEL_CONFIG_KEY, "rc1");
    const client = makeFakePumbleClient();
    const handler = makeReportAnonHandler(deps);
    await handler(
      makeBlockInteractionCtx({
        userId: "recipient-1",
        value: "c1:recipient",
        botClient: client,
      }) as any,
    );
    const reportRow = deps.auditLog
      .listRecent(10)
      .find((r) => r.event_type === "REPORT");
    expect(reportRow).toBeDefined();
    expect(reportRow?.actor_id).toBe("recipient-1");
    expect(reportRow?.target_id).toBe("sender-1");
    // Audit row never contains the raw message body
    expect(JSON.stringify(reportRow)).not.toContain("private content");
  });
});

// H-1 regression: auditLogRepo.record must warn when called without a
// workspaceId so operators can find and fix the offending call site.
// The row is still written (the column stays nullable for now) because
// dropping an audit row on missing metadata is worse than a noisy log.
describe("auditLogRepo workspace warn", () => {
  function openRepoWithLogger() {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db, MIGRATIONS_DIR);
    const logger = makeTestLogger();
    const repo = makeAuditLogRepo(db, logger);
    return { repo, logger };
  }

  it("warns when record() is called without workspaceId", () => {
    const { repo, logger } = openRepoWithLogger();
    repo.record({ eventType: "REPORT_CHANNEL_SETUP", metadata: { outcome: "setup-failed" } });
    const warns = logger.entries.filter((e) => e.level === "warn");
    expect(warns.length).toBeGreaterThanOrEqual(1);
    const warned = warns.find((e) =>
      (e.msg ?? "").includes("audit row missing workspaceId"),
    );
    expect(warned).toBeDefined();
    // The row still gets written so the event is not lost.
    expect(repo.listRecent(10)).toHaveLength(1);
  });

  it("does not warn when workspaceId is present", () => {
    const { repo, logger } = openRepoWithLogger();
    repo.record({
      eventType: "REPORT",
      workspaceId: "ws-1",
      actorId: "u1",
      convId: "c1",
    });
    const warns = logger.entries.filter(
      (e) => e.level === "warn" && (e.msg ?? "").includes("audit row missing workspaceId"),
    );
    expect(warns).toHaveLength(0);
  });
});
