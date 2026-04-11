/**
 * Startup configuration loader.
 *
 * Responsibilities:
 * - Read every required environment variable exactly once at import time.
 * - Fail fast with a precise message if any required secret is missing,
 *   empty, or does not match the expected format.
 * - Expose an immutable, typed `config` object to the rest of the app.
 *
 * Required env vars are sourced exclusively from the process environment. This
 * module does NOT read `.pumbleapprc` — that file is a CLI-only convenience
 * for local development and must not be treated as a production secret source.
 *
 * See SECURITY.md for the rotation checklist.
 */

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface AppConfig {
  readonly pumble: {
    readonly appId: string;
    readonly appKey: string;
    readonly clientSecret: string;
    readonly signingSecret: string;
  };
  readonly databasePath: string;
  readonly logLevel: LogLevel;
  readonly port: number;
  readonly nodeEnv: "development" | "test" | "production";
}

/** Secrets with their expected formats (from .env.example). */
const SECRET_SPECS = [
  { name: "PUMBLE_APP_ID",             pattern: /^[0-9a-f]{24}$/i,            hint: "24-character hex string" },
  { name: "PUMBLE_APP_KEY",            pattern: /^xpat-[0-9a-f]{32}$/,        hint: "xpat-<32 hex chars>" },
  { name: "PUMBLE_APP_CLIENT_SECRET",  pattern: /^xpcls-[0-9a-f]{32}$/,       hint: "xpcls-<32 hex chars>" },
  { name: "PUMBLE_APP_SIGNING_SECRET", pattern: /^xpss-[0-9a-f]{32}$/,        hint: "xpss-<32 hex chars>" },
] as const;

const ALLOWED_LOG_LEVELS: readonly LogLevel[] = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        `See SECURITY.md and .env.example for the full list of expected values.`,
    );
  }
  return value.trim();
}

function requireSecret(name: string, pattern: RegExp, hint: string): string {
  const value = requireEnv(name);
  if (!pattern.test(value)) {
    throw new Error(
      `[config] ${name} has an unexpected format. Expected: ${hint}. ` +
        `Check that the value was copied correctly from the Pumble marketplace.`,
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim();
}

function parsePort(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65_535) {
    throw new Error(
      `[config] PORT must be an integer in 1..65535, got '${raw}'.`,
    );
  }
  return n;
}

function parseLogLevel(raw: string): LogLevel {
  if ((ALLOWED_LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  throw new Error(
    `[config] LOG_LEVEL must be one of ${ALLOWED_LOG_LEVELS.join(
      ", ",
    )}, got '${raw}'.`,
  );
}

function parseNodeEnv(raw: string): AppConfig["nodeEnv"] {
  if (raw === "development" || raw === "test" || raw === "production") {
    return raw;
  }
  throw new Error(
    `[config] NODE_ENV must be one of development, test, production (got '${raw}').`,
  );
}

export function loadConfig(): AppConfig {
  const [appId, appKey, clientSecret, signingSecret] = SECRET_SPECS.map(
    ({ name, pattern, hint }) => requireSecret(name, pattern, hint),
  ) as [string, string, string, string];

  const cfg: AppConfig = {
    pumble: {
      appId,
      appKey,
      clientSecret,
      signingSecret,
    },
    databasePath: optionalEnv("DATABASE_PATH", "./data/anon.db"),
    logLevel: parseLogLevel(optionalEnv("LOG_LEVEL", "info")),
    port: parsePort(optionalEnv("PORT", "3000")),
    nodeEnv: parseNodeEnv(optionalEnv("NODE_ENV", "development")),
  };

  return Object.freeze({
    ...cfg,
    pumble: Object.freeze(cfg.pumble),
  });
}
