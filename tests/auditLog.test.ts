import { describe, it, expect } from "vitest";
import { makeAnonCommand } from "../src/commands/anon";
import { makeAnonBlockCommand } from "../src/commands/anonBlock";
import { makeAnonUnblockCommand } from "../src/commands/anonUnblock";
import { makeReportAnonHandler } from "../src/interactions/reportAnon";
import { makeTestDeps } from "./helpers/deps";
import { makeSlashCommandCtx, makeBlockInteractionCtx } from "./helpers/ctx";
import { makeFakePumbleClient } from "./helpers/pumbleClient";
import { REPORT_CHANNEL_CONFIG_KEY } from "../src/services/reportChannel";

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
    deps.repos.conversations.insert("c1", "ws-1", "sender-1", "recipient-1");
    deps.repos.conversations.updateLastMessage("c1", "private content");
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
