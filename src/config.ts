/**
 * Startup configuration loader.
 *
 * Responsibilities:
 * - Read every required environment variable exactly once at import time.
 * - Fail fast with a precise message if any required secret is missing or empty.
 * - Expose an immutable, typed `config` object to the rest of the app.
 *
 * Required env vars are sourced exclusively from the process environment. This
 * module does NOT read `.pumbleapprc` — that file is a CLI-only convenience
 * for local development and must not be treated as a production secret source.
 *
 * See SECURITY.md for the rotation checklist.
 */

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

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

const REQUIRED_SECRETS = [
  "PUMBLE_APP_ID",
  "PUMBLE_APP_KEY",
  "PUMBLE_APP_CLIENT_SECRET",
  "PUMBLE_APP_SIGNING_SECRET",
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
  // Verify every required secret is present before we build the object,
  // so the error message lists the actual variable name and nothing else
  // leaks from the exception path.
  for (const name of REQUIRED_SECRETS) {
    requireEnv(name);
  }

  const cfg: AppConfig = {
    pumble: {
      appId: requireEnv("PUMBLE_APP_ID"),
      appKey: requireEnv("PUMBLE_APP_KEY"),
      clientSecret: requireEnv("PUMBLE_APP_CLIENT_SECRET"),
      signingSecret: requireEnv("PUMBLE_APP_SIGNING_SECRET"),
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
