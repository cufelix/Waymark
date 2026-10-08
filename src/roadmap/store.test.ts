import assert from "node:assert/strict";
import test from "node:test";
import type { Roadmap } from "./contracts.ts";
import { MemoryRoadmapStore } from "./store.ts";
import { OCCUPATION, PROFILE, VALIDATION } from "./testdata/validation.ts";

const roadmap = (roadmapId: string, seekerId = PROFILE.seekerId): Roadmap => ({
  roadmapId,
  seekerId,
  validationId: VALIDATION.validationId,
  runId: VALIDATION.runId,
  occupation: OCCUPATION,
  goal: "learn-fast",
  status: "building",
  modules: [],
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
});

test("MemoryRoadmapStore isolates values and deletes only one seeker's roadmaps", async () => {
  const store = new MemoryRoadmapStore();
  const first = roadmap("rmp_00000000000000000000000001");
  const second = roadmap("rmp_00000000000000000000000002");
  const foreign = roadmap("rmp_00000000000000000000000003", "skr_00000000000000000000000002");
  await store.put(first);
  await store.put(second);
  await store.put(foreign);

  first.status = "failed";
  const read = await store.get(first.roadmapId);
  assert.equal(read?.status, "building");
  if (read) read.status = "ready";
  assert.equal((await store.get(first.roadmapId))?.status, "building");
  assert.deepEqual((await store.listBySeeker(PROFILE.seekerId)).map(({ roadmapId }) => roadmapId), [first.roadmapId, second.roadmapId]);

  assert.equal(await store.deleteBySeeker(PROFILE.seekerId), 2);
  assert.equal(await store.get(first.roadmapId), undefined);
  assert.deepEqual(await store.listBySeeker(foreign.seekerId), [foreign]);
});
