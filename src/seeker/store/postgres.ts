import type { SqlClient, SqlPool } from "../../db/types.ts";
import type { Intake } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";
import type { SeekerRecord, SeekerStore } from "./store.ts";

type Row = { record: SeekerRecord; intake: Intake | null };

const expirySql = "now() + ($2 * interval '1 day')";

export class PostgresSeekerStore implements SeekerStore {
  constructor(private readonly db: SqlPool, private readonly retentionDays = 90) {}

  async create(record: SeekerRecord): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO seeker_records (seeker_id, record, expires_at)
         VALUES ($1, $3::jsonb, ${expirySql})`,
        [record.profile.seekerId, this.retentionDays, JSON.stringify(record)],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ApiError("conflict", `Seeker ${record.profile.seekerId} already exists`);
      }
      throw error;
    }
  }

  async get(seekerId: string): Promise<SeekerRecord | null> {
    const { rows } = await this.db.query<Row>(
      "SELECT record, intake FROM seeker_records WHERE seeker_id = $1 AND expires_at > now()",
      [seekerId],
    );
    return rows[0] ? structuredClone(rows[0].record) : null;
  }

  async update(seekerId: string, fn: (record: SeekerRecord) => SeekerRecord): Promise<SeekerRecord> {
    return this.transaction(seekerId, async (client, row) => {
      const next = fn(structuredClone(row.record));
      await client.query(
        `UPDATE seeker_records
            SET record = $2::jsonb, updated_at = now(), expires_at = now() + ($3 * interval '1 day')
          WHERE seeker_id = $1`,
        [seekerId, JSON.stringify(next), this.retentionDays],
      );
      return structuredClone(next);
    });
  }

  async updateRecordAndIntake(
    seekerId: string,
    fn: (record: SeekerRecord, intake: Intake) => { record: SeekerRecord; intake: Intake },
  ): Promise<{ record: SeekerRecord; intake: Intake }> {
    return this.transaction(seekerId, async (client, row) => {
      if (!row.intake) throw new ApiError("not_found", `Intake for seeker ${seekerId} does not exist`);
      const next = fn(structuredClone(row.record), structuredClone(row.intake));
      await client.query(
        `UPDATE seeker_records
            SET record = $2::jsonb, intake = $3::jsonb, updated_at = now(),
                expires_at = now() + ($4 * interval '1 day')
          WHERE seeker_id = $1`,
        [seekerId, JSON.stringify(next.record), JSON.stringify(next.intake), this.retentionDays],
      );
      return structuredClone(next);
    });
  }

  async getIntake(seekerId: string): Promise<Intake | undefined> {
    const { rows } = await this.db.query<Pick<Row, "intake">>(
      "SELECT intake FROM seeker_records WHERE seeker_id = $1 AND expires_at > now()",
      [seekerId],
    );
    return rows[0]?.intake ? structuredClone(rows[0].intake) : undefined;
  }

  async putIntake(intake: Intake): Promise<void> {
    const result = await this.db.query(
      `UPDATE seeker_records
          SET intake = $2::jsonb, updated_at = now(), expires_at = now() + ($3 * interval '1 day')
        WHERE seeker_id = $1 AND expires_at > now()`,
      [intake.seekerId, JSON.stringify(intake), this.retentionDays],
    );
    if (result.rowCount === 0) throw new ApiError("not_found", `Seeker ${intake.seekerId} does not exist`);
  }

  async delete(seekerId: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM seeker_records WHERE seeker_id = $1", [seekerId]);
    return (result.rowCount ?? 0) > 0;
  }

  private async transaction<T>(seekerId: string, fn: (client: SqlClient, row: Row) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<Row>(
        "SELECT record, intake FROM seeker_records WHERE seeker_id = $1 AND expires_at > now() FOR UPDATE",
        [seekerId],
      );
      const row = rows[0];
      if (!row) throw new ApiError("not_found", `Seeker ${seekerId} does not exist`);
      const value = await fn(client, row);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
