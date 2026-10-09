import type { SqlPool } from "../db/types.ts";
import type { Validation } from "./contracts.ts";
import type { GapStore } from "./store.ts";

type Row = { data: Validation };

export class PostgresGapStore implements GapStore {
  constructor(private readonly db: SqlPool, private readonly retentionDays = 90) {}

  async put(validation: Validation): Promise<void> {
    await this.db.query(
      `INSERT INTO validations (validation_id, seeker_id, data, expires_at)
       VALUES ($1, $2, $3::jsonb, now() + ($4 * interval '1 day'))
       ON CONFLICT (validation_id) DO UPDATE
         SET seeker_id = EXCLUDED.seeker_id, data = EXCLUDED.data, updated_at = now(),
             expires_at = now() + ($4 * interval '1 day')`,
      [validation.validationId, validation.seekerId, JSON.stringify(validation), this.retentionDays],
    );
  }

  async get(validationId: string): Promise<Validation | null> {
    const { rows } = await this.db.query<Row>(
      "SELECT data FROM validations WHERE validation_id = $1 AND expires_at > now()",
      [validationId],
    );
    return rows[0] ? structuredClone(rows[0].data) : null;
  }

  async listBySeeker(seekerId: string): Promise<Validation[]> {
    const { rows } = await this.db.query<Row>(
      "SELECT data FROM validations WHERE seeker_id = $1 AND expires_at > now() ORDER BY created_at, validation_id",
      [seekerId],
    );
    return rows.map(({ data }) => structuredClone(data));
  }

  async deleteBySeeker(seekerId: string): Promise<number> {
    const result = await this.db.query("DELETE FROM validations WHERE seeker_id = $1", [seekerId]);
    return result.rowCount ?? 0;
  }
}
