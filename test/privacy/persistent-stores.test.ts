import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool";
import { PostgresGapStore } from "../../src/gap/postgres-store";
import { purgeExpiredPersonalData } from "../../src/privacy/retention";
import type { Roadmap } from "../../src/roadmap/contracts";
import { PostgresRoadmapStore } from "../../src/roadmap/postgres-store";
import { OCCUPATION, PROFILE, VALIDATION } from "../../src/roadmap/testdata/validation";
import type { Intake } from "../../src/seeker/contracts";
import { PostgresSeekerStore } from "../../src/seeker/store/postgres";
import { PostgresDeletionQueue } from "../../src/seeker/store/deletion-jobs";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const seekerId = `skr_persistence_${suffix}`;
const validationId = `val_persistence_${suffix}`;
const roadmapId = `rmp_persistence_${suffix}`;

const seeker = {
  profile: { ...structuredClone(PROFILE), seekerId },
  interview: [],
  draft: {},
  cvTexts: {},
};

const intake: Intake = {
  seekerId,
  phase: "done",
  warmup: { questions: [], answers: [] },
  cards: { rated: [], done: true },
  paths: [],
  deck: { country: "CZ", version: "test" },
};

const validation = { ...structuredClone(VALIDATION), validationId, seekerId };
const roadmap: Roadmap = {
  roadmapId,
  seekerId,
  validationId,
  runId: validation.runId,
  occupation: OCCUPATION,
  goal: "learn-fast",
  status: "ready",
  modules: [],
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};

afterAll(async () => {
  await pool.query("DELETE FROM seeker_deletion_jobs WHERE seeker_id = $1", [seekerId]);
  await pool.query("DELETE FROM roadmaps WHERE roadmap_id = $1", [roadmapId]);
  await pool.query("DELETE FROM validations WHERE validation_id = $1", [validationId]);
  await pool.query("DELETE FROM seeker_records WHERE seeker_id = $1", [seekerId]);
});

describe("PostgreSQL personal-data stores", () => {
  it("survives new store instances and updates record plus intake atomically", async () => {
    const first = new PostgresSeekerStore(pool, 90);
    await first.create(seeker);
    await first.putIntake(intake);

    const second = new PostgresSeekerStore(pool, 90);
    expect((await second.get(seekerId))?.profile.seekerId).toBe(seekerId);
    expect((await second.getIntake(seekerId))?.phase).toBe("done");

    const changed = await second.updateRecordAndIntake(seekerId, (record, storedIntake) => ({
      record: { ...record, draft: { ...record.draft, goal: "stability" } },
      intake: { ...storedIntake, phase: "chat" },
    }));
    expect(changed.record.draft.goal).toBe("stability");
    expect(changed.intake.phase).toBe("chat");
    expect((await first.getIntake(seekerId))?.phase).toBe("chat");
  });

  it("persists validations and preserves atomic roadmap replacement", async () => {
    const gaps = new PostgresGapStore(pool, 90);
    await gaps.put(validation);
    expect((await new PostgresGapStore(pool, 90).get(validationId))?.seekerId).toBe(seekerId);

    const roadmaps = new PostgresRoadmapStore(pool, 90);
    await roadmaps.put(roadmap);
    expect(await roadmaps.replaceIfExists({ ...roadmap, status: "failed" })).toBe(true);
    expect((await new PostgresRoadmapStore(pool, 90).get(roadmapId))?.status).toBe("failed");
    await roadmaps.deleteBySeeker(seekerId);
    expect(await roadmaps.replaceIfExists(roadmap)).toBe(false);
  });

  it("hides and purges expired records", async () => {
    const roadmaps = new PostgresRoadmapStore(pool, 90);
    await roadmaps.put(roadmap);
    await pool.query("UPDATE seeker_records SET expires_at = now() - interval '1 second' WHERE seeker_id = $1", [seekerId]);
    await pool.query("UPDATE validations SET expires_at = now() - interval '1 second' WHERE validation_id = $1", [validationId]);
    await pool.query("UPDATE roadmaps SET expires_at = now() - interval '1 second' WHERE roadmap_id = $1", [roadmapId]);

    expect(await new PostgresSeekerStore(pool).get(seekerId)).toBeNull();
    const purged = await purgeExpiredPersonalData();
    expect(purged.seekers).toBeGreaterThanOrEqual(1);
    expect(await pool.query("SELECT 1 FROM seeker_records WHERE seeker_id = $1", [seekerId])).toHaveProperty("rowCount", 0);
  });

  it("persists and atomically claims deletion retries", async () => {
    const queue = new PostgresDeletionQueue(pool);
    await queue.request(seekerId);
    expect(await queue.claimDue()).toContain(seekerId);
    expect(await queue.claimDue()).not.toContain(seekerId);
    await queue.fail(seekerId, "upstream_failed");
    const row = await pool.query<{ attempts: number; last_error: string }>(
      "SELECT attempts, last_error FROM seeker_deletion_jobs WHERE seeker_id = $1",
      [seekerId],
    );
    expect(row.rows[0]).toMatchObject({ attempts: 1, last_error: "upstream_failed" });
    await queue.complete(seekerId);
  });
});
