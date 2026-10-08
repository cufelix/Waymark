import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../core/errors.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeResearchClient } from "../research-client.ts";
import { createSeeker, getProfile } from "./seekers.ts";
import { deleteSeeker, exportSeeker } from "./gdpr.ts";
import type { Consent } from "../contracts.ts";

const consent: Consent = { dataProcessing: true, nameSearch: false, givenAt: "2026-10-08T21:00:00Z", policyVersion: "2026-10-01" };
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;
const setup = () => ({ store: new MemoryStore(), research: new FakeResearchClient() });

test("export returns profile, interview and Part 2's runs for that seeker only", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  const b = (await createSeeker(deps, consent)).seekerId;
  await deps.store.update(a, (r) => ({ ...r, interview: [{ role: "agent", text: "What do you do?", at: "2026-10-08T21:00:00Z" }] }));
  deps.research.runs.set(a, [{ runId: "run_A", seekerId: a }]);
  deps.research.runs.set(b, [{ runId: "run_B", seekerId: b }]);
  const ex = await exportSeeker(deps, a);
  assert.equal(ex.profile.seekerId, a);
  assert.equal(ex.interview.length, 1);
  assert.deepEqual(ex.researchRuns, [{ runId: "run_A", seekerId: a }]);
  assert.deepEqual(Object.keys(ex).sort(), ["interview", "profile", "researchRuns"]);
});

test("export fails with upstream_failed when Part 2 is down, not_found for unknown seeker", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  deps.research.failLists = true;
  await assert.rejects(exportSeeker(deps, a), code("upstream_failed"));
  await assert.rejects(exportSeeker(deps, "skr_01M4EPBGAC0000000000000000"), code("not_found"));
});

test("delete: Part 2 first, then hard delete", async () => {
  const deps = setup();
  const a = (await createSeeker(deps, consent)).seekerId;
  deps.research.runs.set(a, [{ runId: "run_A" }]);
  assert.deepEqual(await deleteSeeker(deps, a), { deleted: true });
  assert.deepEqual(deps.research.deleted, [a]);
  assert.equal(await deps.store.get(a), null);
  await assert.rejects(deleteSeeker(deps, a), code("not_found"));
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
