import { config } from "../config";
import { pool } from "../db/pool";
import { log, errorMessage } from "../log";
import { deleteResearchForSeeker, deleteRun } from "../research/gdpr";

const RETENTION_LOCK = 727002;

export type PurgeResult = {
  seekers: number;
  validations: number;
  roadmaps: number;
  researchRuns: number;
  skipped: boolean;
};

/**
 * Purges expired personal data in cascade order. The advisory lock makes the job safe when API and
 * worker processes share one database. Research deletion uses the normal snapshot-aware path.
 */
export async function purgeExpiredPersonalData(): Promise<PurgeResult> {
  const lock = await pool.connect();
  const result: PurgeResult = { seekers: 0, validations: 0, roadmaps: 0, researchRuns: 0, skipped: false };
  let locked = false;
  try {
    const acquired = await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [RETENTION_LOCK]);
    if (!acquired.rows[0]?.locked) return { ...result, skipped: true };
    locked = true;

    const expiredSeekers = await lock.query<{ seeker_id: string }>(
      "SELECT seeker_id FROM seeker_records WHERE expires_at <= now() ORDER BY expires_at LIMIT 100",
    );
    for (const { seeker_id: seekerId } of expiredSeekers.rows) {
      result.roadmaps += (await lock.query("DELETE FROM roadmaps WHERE seeker_id = $1", [seekerId])).rowCount ?? 0;
      result.validations += (await lock.query("DELETE FROM validations WHERE seeker_id = $1", [seekerId])).rowCount ?? 0;
      result.researchRuns += await deleteResearchForSeeker(seekerId);
      result.seekers += (await lock.query("DELETE FROM seeker_records WHERE seeker_id = $1", [seekerId])).rowCount ?? 0;
      await lock.query("DELETE FROM seeker_deletion_jobs WHERE seeker_id = $1", [seekerId]);
    }

    const expiredRuns = await lock.query<{ id: string }>(
      "SELECT id FROM research_runs WHERE expires_at <= now() ORDER BY expires_at LIMIT 100",
    );
    for (const { id } of expiredRuns.rows) result.researchRuns += await deleteRun(id);

    result.roadmaps += (await lock.query("DELETE FROM roadmaps WHERE expires_at <= now()")).rowCount ?? 0;
    result.validations += (await lock.query("DELETE FROM validations WHERE expires_at <= now()")).rowCount ?? 0;
    return result;
  } finally {
    if (locked) await lock.query("SELECT pg_advisory_unlock($1)", [RETENTION_LOCK]).catch(() => undefined);
    lock.release();
  }
}

export function startRetentionWorker(): () => void {
  const run = (): void => {
    purgeExpiredPersonalData()
      .then((result) => {
        if (!result.skipped && (result.seekers + result.validations + result.roadmaps + result.researchRuns > 0)) {
          log.info("expired personal data purged", result);
        }
      })
      .catch((error) => log.error("retention purge failed", { error: errorMessage(error) }));
  };
  const timer = setInterval(run, config.RETENTION_PURGE_INTERVAL_MINUTES * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
