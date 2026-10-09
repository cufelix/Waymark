import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool";

describe("personal-data migration", () => {
  it("backfills research expiry from created_at and the configured retention period", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path = pg_temp");
      await client.query(`CREATE TEMP TABLE research_runs (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL
      )`);
      await client.query(
        "INSERT INTO research_runs (id, created_at) VALUES ('run_old', '2025-01-02T03:04:05.000Z')",
      );
      await client.query("SELECT set_config('waymark.personal_data_retention_days', '37', true)");
      const migration = await readFile(
        new URL("../../src/db/migrations/002_personal_data.sql", import.meta.url),
        "utf8",
      );

      await client.query(migration);

      const { rows } = await client.query<{ created_at: Date; expires_at: Date }>(
        "SELECT created_at, expires_at FROM research_runs WHERE id = 'run_old'",
      );
      expect(rows[0]?.expires_at.toISOString()).toBe("2025-02-08T03:04:05.000Z");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
