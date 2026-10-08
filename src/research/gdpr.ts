// Export and hard delete of everything Part 2 stores about a seeker.
import type { ResearchRun } from "../contracts";
import { query } from "../db/pool";
import { deleteSnapshot } from "../storage/snapshots";
import { getRunRow, toRun } from "./run";

export async function listRunsForSeeker(seekerId: string): Promise<ResearchRun[]> {
  const ids = await query<{ id: string }>("SELECT id FROM research_runs WHERE seeker_id = $1 ORDER BY created_at", [seekerId]);
  const runs: ResearchRun[] = [];
  for (const { id } of ids) {
    const row = await getRunRow(id);
    if (row) runs.push(await toRun(row));
  }
  return runs;
}

/**
 * Deletes runs (and through the cascade their artifacts, run links and name-search results) plus the
 * snapshot files only those artifacts used. Snapshots are content-addressed, so a file another seeker's
 * artifact also points to is kept. Files go first: a failure after that leaves rows without files, never
 * files nobody can find to delete.
 */
async function purge(column: "id" | "seeker_id", value: string): Promise<number> {
  const keys = await query<{ key: string }>(
    `SELECT DISTINCT a.data->'source'->>'snapshotKey' AS key
       FROM artifacts a JOIN research_runs r ON r.id = a.run_id
      WHERE r.${column} = $1
        AND a.data->'source'->>'snapshotKey' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM artifacts b JOIN research_runs rb ON rb.id = b.run_id
           WHERE rb.${column} <> $1 AND b.data->'source'->>'snapshotKey' = a.data->'source'->>'snapshotKey')`,
    [value],
  );
  for (const { key } of keys) await deleteSnapshot(key);
  const deleted = await query("DELETE FROM research_runs WHERE " + column + " = $1 RETURNING id", [value]);
  return deleted.length;
}

export const deleteResearchForSeeker = (seekerId: string): Promise<number> => purge("seeker_id", seekerId);

/** Deletes one run. A running run is stopped this way too: its worker finds the row gone and stops writing. */
export const deleteRun = (runId: string): Promise<number> => purge("id", runId);
