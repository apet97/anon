import pino from "pino";

/**
 * Central pino logger with redaction rules tight enough to prevent
 * secrets or raw message bodies from leaking into application logs.
 *
 * The redaction paths are:
 * - Known token field names at any depth (camelCase and snake_case).
 * - Authorization / cookie headers at the top level and one level deep.
 * - The `PUMBLE_APP_*` env-var names.
 * - `messageText` / `replyText` / `body.text` — defence in depth for
 *   the case where a handler accidentally passes user content.
 *
 * Handler code should never put the raw message body in the log
 * record; this redaction list is the last line of defence, not the
 * first.
 */
export type Logger = pino.Logger;

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface LoggerDeps {
  level?: LogLevel;
  prettyPrint?: boolean;
}

export function makeLogger({ level = "info", prettyPrint = false }: LoggerDeps = {}): Logger {
  const redact = {
    paths: [
      // Token fields — camelCase
      "accessToken",
      "botToken",
      "userToken",
      "signingSecret",
      "clientSecret",
      // Token fields — snake_case (OAuth responses, SDK internals)
      "access_token",
      "bot_token",
      "user_token",
      "signing_secret",
      "client_secret",
      // Authorization headers at the top level and one level deep
      "authorization",
      "headers.authorization",
      "headers.cookie",
      // Pumble env-var names (logged on boot via config object)
      "PUMBLE_APP_ID",
      "PUMBLE_APP_KEY",
      "PUMBLE_APP_CLIENT_SECRET",
      "PUMBLE_APP_SIGNING_SECRET",
      // Message content — defence in depth
      "messageText",
      "replyText",
      "body.text",
      // Wildcard (one level deep) versions
      "*.accessToken",
      "*.botToken",
      "*.userToken",
      "*.signingSecret",
      "*.clientSecret",
      "*.access_token",
      "*.bot_token",
      "*.user_token",
      "*.signing_secret",
      "*.client_secret",
      "*.authorization",
      "*.headers.authorization",
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
