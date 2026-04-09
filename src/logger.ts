import pino from "pino";

/**
 * Central pino logger with redaction rules tight enough to prevent
 * secrets or raw message bodies from leaking into application logs.
 *
 * The redaction paths are:
 * - Known token field names at any depth.
 * - The `PUMBLE_APP_*` env-var names.
 * - `messageText` / `replyText` / `body.text` — defence in depth for
 *   the case where a handler accidentally passes user content.
 *
 * Handler code should never put the raw message body in the log
 * record; this redaction list is the last line of defence, not the
 * first.
 */
export type Logger = pino.Logger;

export interface LoggerDeps {
  level?: string;
  prettyPrint?: boolean;
}

export function makeLogger({ level = "info", prettyPrint = false }: LoggerDeps = {}): Logger {
  const redact = {
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
      "*.accessToken",
      "*.access_token",
      "*.botToken",
      "*.bot_token",
      "*.userToken",
      "*.user_token",
      "*.signingSecret",
      "*.clientSecret",
      "*.messageText",
      "*.replyText",
    ],
    censor: "[REDACTED]",
    remove: false,
  };

  if (prettyPrint) {
    return pino({
      level,
      redact,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
      },
    });
  }

  return pino({ level, redact });
}
