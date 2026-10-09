import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../core/errors.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeResearchClient } from "../research-client.ts";
import { FakeRoadmapClient } from "../roadmap-client.ts";
import { createSeeker, getProfile } from "./seekers.ts";
import { deleteSeeker, exportSeeker, retryDeletionJobs } from "./gdpr.ts";
import type { Consent } from "../contracts.ts";
import { FakeValidationClient } from "../validation-client.ts";
import type { Roadmap } from "../../roadmap/contracts.ts";
import type { DeletionQueue } from "../store/deletion-jobs.ts";

const consent: Consent = { dataProcessing: true, nameSearch: false, givenAt: "2026-10-08T21:00:00Z", policyVersion: "2026-10-01" };
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;
const roadmap = (roadmapId: string, seekerId: string): Roadmap => ({
  roadmapId,
  seekerId,
  validationId: "val_FAKE",
  runId: "run_FAKE",
  occupation: { uri: "urn:stub:occupation:example", label: "Example occupation", lang: "en" },
  goal: "learn-fast",
  status: "ready",
  modules: [],
  createdAt: "2026-10-08T21:00:00Z",
  updatedAt: "2026-10-08T21:00:00Z",
});
const setup = () => ({
  store: new MemoryStore(),
  research: new FakeResearchClient(),
  validations: new FakeValidationClient(),
  roadmaps: new FakeRoadmapClient(),
});

class FakeDeletionQueue implements DeletionQueue {
  pending = new Set<string>();
  failures: string[] = [];
  async request(seekerId: string): Promise<void> { this.pending.add(seekerId); }
  async complete(seekerId: string): Promise<void> { this.pending.delete(seekerId); }
  async fail(_seekerId: string, failureCode: string): Promise<void> { this.failures.push(failureCode); }
  async claimDue(): Promise<string[]> { return [...this.pending]; }
}

test("export returns profile, interview, research runs, validations and roadmaps for that seeker only", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  const b = (await createSeeker(deps, consent)).seekerId;
  await deps.store.update(a, (r) => ({ ...r, interview: [{ role: "agent", text: "What do you do?", at: "2026-10-08T21:00:00Z" }] }));
  deps.research.runs.set(a, [{ runId: "run_A", seekerId: a }]);
  deps.research.runs.set(b, [{ runId: "run_B", seekerId: b }]);
  deps.validations.validations.set(a, [{ validationId: "val_A", seekerId: a }]);
  deps.validations.validations.set(b, [{ validationId: "val_B", seekerId: b }]);
  deps.roadmaps.roadmaps.set(a, [roadmap("rmp_A", a)]);
  deps.roadmaps.roadmaps.set(b, [roadmap("rmp_B", b)]);
  const ex = await exportSeeker(deps, a);
  assert.equal(ex.profile.seekerId, a);
  assert.equal(ex.interview.length, 1);
  assert.deepEqual(ex.researchRuns, [{ runId: "run_A", seekerId: a }]);
  assert.deepEqual(ex.validations, [{ validationId: "val_A", seekerId: a }]);
  assert.deepEqual(ex.roadmaps, [roadmap("rmp_A", a)]);
  assert.deepEqual(Object.keys(ex).sort(), ["interview", "profile", "researchRuns", "roadmaps", "validations"]);
});

test("export fails with upstream_failed when Part 2 is down, not_found for unknown seeker", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  deps.research.failLists = true;
  await assert.rejects(exportSeeker(deps, a), code("upstream_failed"));
  await assert.rejects(exportSeeker(deps, "skr_01M4EPBGAC0000000000000000"), code("not_found"));
});

test("delete: Part 4 first, then Part 3, then Part 2, then hard delete", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  deps.research.runs.set(a, [{ runId: "run_A" }]);
  assert.deepEqual(await deleteSeeker(deps, a), { deleted: true });
  assert.deepEqual(deps.roadmaps.deleted, [a]);
  assert.deepEqual(deps.validations.deleted, [a]);
  assert.deepEqual(deps.research.deleted, [a]);
  assert.equal(await deps.store.get(a), null);
  await assert.rejects(deleteSeeker(deps, a), code("not_found"));
});

test("delete with failing Part 4: 502, deletion-pending, and Parts 3 and 2 wait for retry", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  deps.roadmaps.failDeletes = 1;
  await assert.rejects(deleteSeeker(deps, a), code("upstream_failed"));
  assert.equal((await deps.store.get(a))?.deletionPending, true);
  assert.deepEqual(deps.validations.deleted, [], "Part 3 must not run before Part 4 succeeds");
  assert.deepEqual(deps.research.deleted, [], "Part 2 must not run before Part 4 succeeds");
  await assert.rejects(getProfile(deps, a), code("not_found"));
  assert.deepEqual(await deleteSeeker(deps, a), { deleted: true });
  assert.deepEqual(deps.roadmaps.deleted, [a]);
  assert.deepEqual(deps.validations.deleted, [a]);
  assert.deepEqual(deps.research.deleted, [a]);
  assert.equal(await deps.store.get(a), null);
});

test("delete with failing Part 3: 502, deletion-pending, and Part 2 waits for retry", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  deps.validations.failDeletes = 1;
  await assert.rejects(deleteSeeker(deps, a), code("upstream_failed"));
  assert.equal((await deps.store.get(a))?.deletionPending, true);
  assert.deepEqual(deps.roadmaps.deleted, [a]);
  assert.deepEqual(deps.research.deleted, [], "Part 2 must not run before Part 3 succeeds");
  await assert.rejects(getProfile(deps, a), code("not_found"));
  assert.deepEqual(await deleteSeeker(deps, a), { deleted: true });
  assert.deepEqual(deps.validations.deleted, [a]);
  assert.deepEqual(deps.research.deleted, [a]);
  assert.equal(await deps.store.get(a), null);
});

test("delete with failing Part 2: 502, deletion-pending hides the seeker, retry finishes it", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  deps.research.failDeletes = 1;
  await assert.rejects(deleteSeeker(deps, a), code("upstream_failed"));
  assert.equal((await deps.store.get(a))?.deletionPending, true);
  await assert.rejects(getProfile(deps, a), code("not_found"));
  assert.equal((await exportSeeker(deps, a)).profile.seekerId, a, "export still works while pending");
  assert.deepEqual(await deleteSeeker(deps, a), { deleted: true });
  assert.equal(await deps.store.get(a), null);
});

test("failed cascade deletion is persisted and completed by the retry worker", async () => {
  const deps = { ...setup(), deletions: new FakeDeletionQueue() };
  const seekerId = (await createSeeker(deps, consent)).seekerId;
  deps.roadmaps.failDeletes = 1;

  await assert.rejects(deleteSeeker(deps, seekerId), code("upstream_failed"));
  assert.deepEqual(deps.deletions.failures, ["roadmap_delete_failed"]);
  assert.equal(deps.deletions.pending.has(seekerId), true);

  assert.deepEqual(await retryDeletionJobs(deps), { completed: 1, failed: 0 });
  assert.equal(deps.deletions.pending.has(seekerId), false);
  assert.equal(await deps.store.get(seekerId), null);
});
