import { config as loadEnv } from "dotenv";

loadEnv({ path: process.env.DOTENV_CONFIG_PATH ?? ".env" });
loadEnv({ path: "../.env" });

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  env: str("NODE_ENV", "development"),
  port: num("PORT", 3000),
  appUrl: str("APP_URL", "http://localhost:3000"),
  clientUrl: str("CLIENT_URL", "http://localhost:5173"),
  get databaseUrl(): string {
    return str(
      "DATABASE_URL",
      "postgres://postgres:postgres@localhost:5432/tabletennis",
    );
  },
  sessionSecret: str("SESSION_SECRET", "dev-insecure-secret-change-me"),
  sessionTtlHours: num("SESSION_TTL_HOURS", 72),
  cookieSecure: str("COOKIE_SECURE", "false") === "true",
  allowedOrigins: str(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  gameTickHz: num("GAME_TICK_HZ", 60),
  disconnectGraceMs: num("MATCH_DISCONNECT_GRACE_MS", 30000),
  pointScore: num("MATCH_POINT_SCORE", 11),
  logLevel: str("LOG_LEVEL", "info"),
  isProd: str("NODE_ENV", "development") === "production",
} as const;

export type Config = typeof config;
