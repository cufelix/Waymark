import type { SqlPool } from "../db/types.ts";
import type { Roadmap } from "./contracts.ts";
import type { RoadmapStore } from "./store.ts";

type Row = { data: Roadmap };

export class PostgresRoadmapStore implements RoadmapStore {
  constructor(private readonly db: SqlPool, private readonly retentionDays = 90) {}

  async put(roadmap: Roadmap): Promise<void> {
    await this.db.query(
      `INSERT INTO roadmaps (roadmap_id, seeker_id, data, expires_at)
       VALUES ($1, $2, $3::jsonb, now() + ($4 * interval '1 day'))
       ON CONFLICT (roadmap_id) DO UPDATE
         SET seeker_id = EXCLUDED.seeker_id, data = EXCLUDED.data, updated_at = now(),
             expires_at = now() + ($4 * interval '1 day')`,
      [roadmap.roadmapId, roadmap.seekerId, JSON.stringify(roadmap), this.retentionDays],
    );
  }

  async replaceIfExists(roadmap: Roadmap): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE roadmaps
          SET seeker_id = $2, data = $3::jsonb, updated_at = now(),
              expires_at = now() + ($4 * interval '1 day')
        WHERE roadmap_id = $1 AND expires_at > now()`,
      [roadmap.roadmapId, roadmap.seekerId, JSON.stringify(roadmap), this.retentionDays],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async failBuildingOlderThan(
    cutoff: string,
    failure: { error: NonNullable<Roadmap["error"]>; updatedAt: string },
  ): Promise<number> {
    const result = await this.db.query(
      `UPDATE roadmaps
          SET data = data || jsonb_build_object(
                'status', 'failed',
                'error', $2::jsonb,
                'updatedAt', $3::text
              ),
              updated_at = $3::timestamptz
        WHERE data->>'status' = 'building'
          AND updated_at <= $1::timestamptz
          AND expires_at > now()`,
      [cutoff, JSON.stringify(failure.error), failure.updatedAt],
    );
    return result.rowCount ?? 0;
  }

  async get(roadmapId: string): Promise<Roadmap | undefined> {
    const { rows } = await this.db.query<Row>(
      "SELECT data FROM roadmaps WHERE roadmap_id = $1 AND expires_at > now()",
      [roadmapId],
    );
    return rows[0] ? structuredClone(rows[0].data) : undefined;
  }

  async listBySeeker(seekerId: string): Promise<Roadmap[]> {
    const { rows } = await this.db.query<Row>(
      "SELECT data FROM roadmaps WHERE seeker_id = $1 AND expires_at > now() ORDER BY created_at, roadmap_id",
      [seekerId],
    );
    return rows.map(({ data }) => structuredClone(data));
  }

  async deleteBySeeker(seekerId: string): Promise<number> {
    const result = await this.db.query("DELETE FROM roadmaps WHERE seeker_id = $1", [seekerId]);
    return result.rowCount ?? 0;
  }
}
