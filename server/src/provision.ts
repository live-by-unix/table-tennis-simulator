// Ensures a reachable PostgreSQL exists.
// 1. If DATABASE_URL is set and connectable -> use it (docker/native installs).
// 2. Otherwise -> auto-start an embedded PostgreSQL (binaries bundled via
//    embedded-postgres) with persistent data in ./data/pg. No Docker required.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = process.env.TTS_PGDATA ?? join(ROOT, "data", "pg");
const PG_PORT = Number(process.env.TTS_PG_PORT ?? 55432);
const PG_USER = "postgres";
const PG_PASS = "postgres";
const PG_DB = "tabletennis";

let embedded: InstanceType<typeof EmbeddedPostgres> | null = null;
let started = false;

async function canConnect(url: string): Promise<boolean> {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 2500 });
  try {
    await c.connect();
    await c.query("SELECT 1");
    await c.end();
    return true;
  } catch {
    try { await c.end(); } catch { /* ignore */ }
    return false;
  }
}

export async function provisionDatabase(): Promise<string> {
  const existing = process.env.DATABASE_URL;
  if (existing && (await canConnect(existing))) {
    return existing;
  }
  if (existing) {
    console.warn(
      `[db] DATABASE_URL set but unreachable (${existing}); falling back to embedded PostgreSQL`,
    );
  } else {
    console.log("[db] DATABASE_URL not set; starting embedded PostgreSQL");
  }

  // If an embedded instance is already running (e.g. started by the server),
  // just adopt it instead of starting a second postmaster.
  const embeddedUrl = `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}`;
  if (await canConnect(embeddedUrl)) {
    process.env.DATABASE_URL = embeddedUrl;
    console.log(`[db] using already-running embedded PostgreSQL at ${embeddedUrl}`);
    return embeddedUrl;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG_USER,
    password: PG_PASS,
    port: PG_PORT,
    persistent: true,
  });
  const marker = join(DATA_DIR, ".tts-initialized");
  if (!existsSync(marker)) {
    await embedded.initialise();
    writeFileSync(marker, "ok");
  }
  await embedded.start();
  try {
    await embedded.createDatabase(PG_DB);
  } catch {
    /* already exists */
  }
  const url = `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}`;
  process.env.DATABASE_URL = url;
  started = true;
  console.log(`[db] embedded PostgreSQL ready at ${url} (data: ${DATA_DIR})`);
  return url;
}

export async function stopEmbedded(): Promise<void> {
  if (embedded && started) {
    try { await embedded.stop(); } catch { /* ignore */ }
  }
}

export function isEmbeddedActive(): boolean {
  return started;
}
