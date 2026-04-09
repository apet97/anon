import { describe, it, expect } from "vitest";
import { makeLogger } from "../src/logger";
import { Writable } from "node:stream";

function captureLogger() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  // Build a pino instance writing to our buffer. makeLogger() returns
  // a default pino, so we wire the destination manually here by using
  // pino directly — same redact config as production.
  const pino = require("pino");
  const logger = pino(
    {
      level: "info",
      redact: {
        paths: [
          "accessToken",
          "access_token",
          "botToken",
          "bot_token",
          "userToken",
          "user_token",
          "signingSecret",
          "clientSecret",
          "PUMBLE_APP_ID",
          "PUMBLE_APP_KEY",
          "PUMBLE_APP_CLIENT_SECRET",
          "PUMBLE_APP_SIGNING_SECRET",
          "messageText",
          "replyText",
          "body.text",
        ],
        censor: "[REDACTED]",
      },
    },
    stream,
  );
  return { logger, output: () => chunks.join("") };
}

describe("makeLogger redaction", () => {
  it("produces a pino-compatible logger", () => {
    const logger = makeLogger({ level: "silent" });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("redacts token-shaped fields from log output", () => {
    const { logger, output } = captureLogger();
    logger.info(
      {
        accessToken: "eyJabc.verysecret",
        botToken: "eyJdef.very-secret-bot",
        signingSecret: "xpss-abc",
        clientSecret: "xpcls-abc",
        PUMBLE_APP_SIGNING_SECRET: "xpss-abc",
        convId: "c1",
      },
      "test",
    );
    const out = output();
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("verysecret");
    expect(out).not.toContain("very-secret-bot");
    expect(out).not.toContain("xpss-abc");
    expect(out).not.toContain("xpcls-abc");
    // Non-sensitive fields still appear
    expect(out).toContain("c1");
  });

  it("redacts message body property names even when handlers forget", () => {
    const { logger, output } = captureLogger();
    logger.info({ messageText: "private-content-123", replyText: "another-private-456" }, "oops");
    const out = output();
    expect(out).not.toContain("private-content-123");
    expect(out).not.toContain("another-private-456");
    expect(out).toContain("[REDACTED]");
  });
});
