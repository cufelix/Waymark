import type { SqlPool } from "../../db/types.ts";

export interface DeletionQueue {
  request(seekerId: string): Promise<void>;
  complete(seekerId: string): Promise<void>;
  fail(seekerId: string, failureCode: string): Promise<void>;
  claimDue(limit?: number): Promise<string[]>;
}

export class PostgresDeletionQueue implements DeletionQueue {
  constructor(private readonly db: SqlPool) {}

  async request(seekerId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO seeker_deletion_jobs (seeker_id) VALUES ($1)
       ON CONFLICT (seeker_id) DO UPDATE
         SET next_attempt_at = LEAST(seeker_deletion_jobs.next_attempt_at, now()), updated_at = now()`,
      [seekerId],
    );
  }

  async complete(seekerId: string): Promise<void> {
    await this.db.query("DELETE FROM seeker_deletion_jobs WHERE seeker_id = $1", [seekerId]);
  }

  async fail(seekerId: string, failureCode: string): Promise<void> {
    await this.db.query(
      `UPDATE seeker_deletion_jobs
          SET attempts = attempts + 1,
              last_error = left($2, 80),
              next_attempt_at = now() + (LEAST(3600, 60 * power(2, attempts)) * interval '1 second'),
              updated_at = now()
        WHERE seeker_id = $1`,
      [seekerId, failureCode],
    );
  }

  async claimDue(limit = 10): Promise<string[]> {
    const { rows } = await this.db.query<{ seeker_id: string }>(
      `UPDATE seeker_deletion_jobs
          SET next_attempt_at = now() + interval '5 minutes', updated_at = now()
        WHERE seeker_id IN (
          SELECT seeker_id FROM seeker_deletion_jobs
           WHERE next_attempt_at <= now()
           ORDER BY next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING seeker_id`,
      [limit],
    );
    return rows.map(({ seeker_id: seekerId }) => seekerId);
  }
}
