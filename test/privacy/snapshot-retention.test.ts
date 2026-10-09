import { afterAll, describe, expect, it, vi } from "vitest";

const snapshot = vi.hoisted(() => ({ deleteSnapshot: vi.fn(async (_key: string) => undefined) }));
vi.mock("../../src/storage/snapshots", () => snapshot);

import { pool } from "../../src/db/pool";
import { deleteResearchForSeeker } from "../../src/research/gdpr";
import { PROFILE } from "../../src/roadmap/testdata/validation";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const seekerId = `skr_snapshot_refs_${suffix}`;
const runIds = ["validation", "roadmap", "orphan"].map((kind) => `run_snapshot_${kind}_${suffix}`);
const validationId = `val_snapshot_${suffix}`;
const roadmapId = `rmp_snapshot_${suffix}`;
const keys = {
  validation: `aa/validation-${suffix}.json`,
  roadmap: `bb/roadmap-${suffix}.json`,
  orphan: `cc/orphan-${suffix}.json`,
};

afterAll(async () => {
  await pool.query("DELETE FROM roadmaps WHERE roadmap_id = $1", [roadmapId]);
  await pool.query("DELETE FROM validations WHERE validation_id = $1", [validationId]);
  await pool.query("DELETE FROM research_runs WHERE id = ANY($1::text[])", [runIds]);
});

describe("snapshot retention", () => {
  it("keeps snapshots copied into live validations and roadmaps", async () => {
    const profile = { ...structuredClone(PROFILE), seekerId };
    for (const [index, runId] of runIds.entries()) {
      await pool.query(
        `INSERT INTO research_runs
           (id, seeker_id, profile_version, profile, options, status, progress, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, '{}'::jsonb, 'done', '[]'::jsonb, now() + interval '1 day')`,
        [runId, seekerId, profile.profileVersion, JSON.stringify(profile)],
      );
      const key = Object.values(keys)[index]!;
      await pool.query(
        `INSERT INTO artifacts (id, run_id, seeker_id, input_id, data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [`art_snapshot_${index}_${suffix}`, runId, seekerId, `lnk_${index}`, JSON.stringify({ source: { snapshotKey: key } })],
      );
    }
    await pool.query(
      `INSERT INTO validations (validation_id, seeker_id, data, expires_at)
       VALUES ($1, $2, $3::jsonb, now() + interval '1 day')`,
      [validationId, seekerId, JSON.stringify({ skills: [{ claims: [{ source: { snapshotKey: keys.validation } }] }] })],
    );
    await pool.query(
      `INSERT INTO roadmaps (roadmap_id, seeker_id, data, expires_at)
       VALUES ($1, $2, $3::jsonb, now() + interval '1 day')`,
      [roadmapId, seekerId, JSON.stringify({ modules: [{ chapters: [{ claims: [{ source: { snapshotKey: keys.roadmap } }] }] }] })],
    );

    expect(await deleteResearchForSeeker(seekerId)).toBe(3);

    expect(snapshot.deleteSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot.deleteSnapshot).toHaveBeenCalledWith(keys.orphan);
  });
});
