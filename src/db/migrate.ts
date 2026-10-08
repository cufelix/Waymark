import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./pool";
import { log } from "../log";

const dir = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Applies every migration file not yet recorded, in name order, each in its own transaction. */
export async function migrate(): Promise<string[]> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files.filter((f) => !done.has(f))) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
