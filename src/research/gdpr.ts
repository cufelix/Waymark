// Export and hard delete of everything Part 2 stores about a seeker.
import type { ResearchRunExport } from "../contracts";
import { pool, query } from "../db/pool";
import type { SqlPool } from "../db/types";
import { deleteSnapshot } from "../storage/snapshots";
import { getRunRow, toRun } from "./run";

export async function listRunsForSeeker(seekerId: string): Promise<ResearchRunExport[]> {
  const ids = await query<{ id: string }>("SELECT id FROM research_runs WHERE seeker_id = $1 ORDER BY created_at", [seekerId]);
  const runs: ResearchRunExport[] = [];
  for (const { id } of ids) {
    const row = await getRunRow(id);
    if (!row) continue;
    const artifacts = await query<{ id: string; input_id: string; data: unknown; created_at: Date }>(
      "SELECT id, input_id, data, created_at FROM artifacts WHERE run_id = $1 ORDER BY created_at, id",
      [id],
    );
    const costLedger = await query<{ at: Date; tool: string; units: string; usd: string; detail: string | null }>(
      "SELECT at, tool, units, usd, detail FROM cost_ledger WHERE run_id = $1 ORDER BY at, id",
      [id],
    );
    runs.push({
      ...await toRun(row),
      storedInput: { profile: row.profile, options: row.options },
      artifacts: artifacts.map((artifact) => ({
        artifactId: artifact.id,
        inputId: artifact.input_id,
        data: artifact.data,
        createdAt: artifact.created_at.toISOString(),
      })),
      costLedger: costLedger.map((entry) => ({
        at: entry.at.toISOString(),
        tool: entry.tool,
        units: Number(entry.units),
        usd: Number(entry.usd),
        ...(entry.detail ? { detail: entry.detail } : {}),
      })),
    });
  }
  return runs;
}

/**
 * Deletes runs (and through the cascade their artifacts, run links and name-search results) plus the
 * snapshot files only those artifacts used. Snapshots are content-addressed, so a file another seeker's
 * artifact also points to is kept. Files go first: a failure after that leaves rows without files, never
 * files nobody can find to delete.
 */
async function purge(column: "id" | "seeker_id", value: string, db: Pick<SqlPool, "query"> = pool): Promise<number> {
  const { rows: keys } = await db.query<{ key: string }>(
    `SELECT DISTINCT a.data->'source'->>'snapshotKey' AS key
       FROM artifacts a JOIN research_runs r ON r.id = a.run_id
      WHERE r.${column} = $1
        AND a.data->'source'->>'snapshotKey' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM artifacts b JOIN research_runs rb ON rb.id = b.run_id
           WHERE rb.${column} <> $1 AND b.data->'source'->>'snapshotKey' = a.data->'source'->>'snapshotKey')
        AND NOT EXISTS (
          SELECT 1
            FROM validations v
            CROSS JOIN LATERAL jsonb_path_query(v.data, '$.**.snapshotKey') AS ref(value)
           WHERE v.expires_at > now()
             AND ref.value = to_jsonb(a.data->'source'->>'snapshotKey'))
        AND NOT EXISTS (
          SELECT 1
            FROM roadmaps m
            CROSS JOIN LATERAL jsonb_path_query(m.data, '$.**.snapshotKey') AS ref(value)
           WHERE m.expires_at > now()
             AND ref.value = to_jsonb(a.data->'source'->>'snapshotKey'))`,
    [value],
  );
  for (const { key } of keys) await deleteSnapshot(key);
  const deleted = await db.query("DELETE FROM research_runs WHERE " + column + " = $1 RETURNING id", [value]);
  return deleted.rowCount ?? 0;
}

export const deleteResearchForSeeker = (
  seekerId: string,
  db?: Pick<SqlPool, "query">,
): Promise<number> => purge("seeker_id", seekerId, db);

/** Deletes one run. A running run is stopped this way too: its worker finds the row gone and stops writing. */
export const deleteRun = (runId: string): Promise<number> => purge("id", runId);
