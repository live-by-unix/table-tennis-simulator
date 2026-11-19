// Dependency-free logical backup/restore using node-pg + JSON.
// Usage:
//   node dist/dbbackup.js dump [outfile]
//   node dist/dbbackup.js restore <infile> [--yes]
import { gzipSync, gunzipSync } from "node:zlib";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { provisionDatabase, stopEmbedded } from "./provision.js";

const { Client } = pg;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKUP_DIR = join(ROOT, "backups");

async function getClient(): Promise<InstanceType<typeof Client>> {
  await provisionDatabase();
  const url = process.env.DATABASE_URL!;
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function listTables(c: InstanceType<typeof Client>): Promise<string[]> {
  const { rows } = await c.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename);
}

async function dump(outfile?: string): Promise<string> {
  const c = await getClient();
  try {
    const tables = await listTables(c);
    const data: Record<string, unknown[]> = {};
    for (const t of tables) {
      const { rows } = await c.query(`SELECT * FROM "${t}"`);
      data[t] = rows;
    }
    mkdirSync(BACKUP_DIR, { recursive: true });
    const file =
      outfile ??
      join(BACKUP_DIR, `tabletennis-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`);
    writeFileSync(file, gzipSync(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tables: data })));
    const total = Object.values(data).reduce((n, r) => n + (r as unknown[]).length, 0);
    console.log(`Backup written: ${file} (${tables.length} tables, ${total} rows)`);
    return file;
  } finally {
    await c.end();
    await stopEmbedded();
  }
}

async function restore(infile: string, assumeYes: boolean): Promise<void> {
  if (!assumeYes) {
    console.error("Refusing to restore without --yes (this replaces all data).");
    process.exit(1);
  }
  const raw = gunzipSync(readFileSync(infile)).toString("utf8");
  const payload = JSON.parse(raw) as { tables: Record<string, Record<string, unknown>[]> };
  const c = await getClient();
  try {
    await c.query("BEGIN");
    // disable FK/trigger checks for load (requires superuser or table owner)
    await c.query("SET session_replication_role = replica");
    for (const [table, rows] of Object.entries(payload.tables)) {
      await c.query(`TRUNCATE "${table}" CASCADE`);
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map((_, i) => `$${i + 1}`);
        await c.query(
          `INSERT INTO "${table}" (${cols.map((c2) => `"${c2}"`).join(",")}) VALUES (${vals.join(",")})`,
          cols.map((k) => {
            const v = row[k];
            if (v instanceof Date) return v.toISOString();
            if (typeof v === "object" && v !== null) return JSON.stringify(v);
            return v;
          }),
        );
      }
    }
    await c.query("SET session_replication_role = DEFAULT");
    await c.query("COMMIT");
    console.log(`Restore complete from ${infile}`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.end();
    await stopEmbedded();
  }
}

const [cmd, arg, flag] = process.argv.slice(2);
if (cmd === "dump") {
  dump(arg).catch((e) => { console.error(e); process.exit(1); });
} else if (cmd === "restore") {
  if (!arg) { console.error("Usage: dbbackup.js restore <file> --yes"); process.exit(1); }
  restore(arg, flag === "--yes").catch((e) => { console.error(e); process.exit(1); });
} else {
  console.error("Usage: dbbackup.js dump [outfile] | restore <infile> --yes");
  process.exit(1);
}
