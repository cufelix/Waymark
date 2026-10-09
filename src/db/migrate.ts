import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./pool";
import { log } from "../log";
import { config } from "../config";

const dir = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Applies every migration file not yet recorded, in name order, each in its own transaction. */
export async function migrate(): Promise<string[]> {
  // One process migrates at a time (API and worker may start together); the others wait, then find nothing to do.
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(727001)");
    return await applyPending();
  } finally {
    await lock.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    lock.release();
  }
}

async function applyPending(): Promise<string[]> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files.filter((f) => !done.has(f))) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Personal-data migrations use this transaction-local setting to backfill from the original
      // creation time without hard-coding the deployment's retention policy.
      await client.query("SELECT set_config('waymark.personal_data_retention_days', $1, true)", [
        String(config.PERSONAL_DATA_RETENTION_DAYS),
      ]);
      await client.query(await readFile(dir + file, "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((applied) => log.info("migrations applied", { applied }))
    .finally(() => pool.end());
}
