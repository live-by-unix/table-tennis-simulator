import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export async function runMigrations(databaseUrl?: string): Promise<string[]> {
  const url = databaseUrl ?? config.databaseUrl;
  const pool = new Pool({ connectionString: url });
  const applied: string[] = [];
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const version = parseInt(file.split("_")[0] ?? "0", 10);
      const { rows } = await pool.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version],
      );
      if (rows.length > 0) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [version],
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
    return applied;
  } finally {
    await pool.end();
  }
}
