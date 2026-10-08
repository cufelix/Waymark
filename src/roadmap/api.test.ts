import assert from "node:assert/strict";
import test from "node:test";
import { FakeLlm } from "../seeker/llm/llm.ts";
import { handle, type RoadmapApiDeps } from "./api.ts";
import type { LearningResource, Roadmap, RoadmapModule } from "./contracts.ts";
import { MemoryResourceCache } from "./resources.ts";
import type { BuildingRoadmap, RoadmapBuilders } from "./service.ts";
import { MemoryRoadmapStore } from "./store.ts";
import { PROFILE, SQL, VALIDATION } from "./testdata/validation.ts";
import { FakeValidationReader } from "./validation-client.ts";

const auth = { Authorization: "Bearer roadmap-test-key" };
const chapterId = "chp_00000000000000000000000001";
const resource: LearningResource = {
  resourceId: "res_00000000000000000000000001",
  title: "Example SQL practice",
  provider: "Example Learning",
  url: "https://example.com/sql",
  format: "practice",
  cost: "free",
  lang: "en",
  source: {
    id: "src_00000000000000000000000020",
    url: "https://example.com/sql",
    title: "Example SQL practice",
    fetchedAt: "2026-10-09T10:00:00.000Z",
    tool: "exa",
    quote: "Free SQL practice exercises.",
    contentHash: "a".repeat(64),
  },
};
const planned: RoadmapModule[] = [{
  moduleId: "mod_00000000000000000000000001",
  title: "Data foundations",
  subtitle: "Queries",
  why: "Start with data work",
  chapters: [{
    chapterId,
    title: "SQL queries",
    category: "data",
    skills: [SQL],
    evidence: "stated",
    claims: structuredClone(VALIDATION.skills[1]!.claims),
    outcome: "Write useful queries",
    resources: [],
    done: true,
    doneBy: "evidence",
  }],
}];

const builders: RoadmapBuilders = {
  pickTarget: () => undefined,
  planModules: async () => structuredClone(planned),
  findResources: async () => ({ resources: [structuredClone(resource)], topPickId: resource.resourceId }),
};

function deps(validations = new FakeValidationReader([VALIDATION])): RoadmapApiDeps {
  return {
    store: new MemoryRoadmapStore(),
    validations,
    llm: new FakeLlm([]),
    exa: null,
    cache: new MemoryResourceCache(),
    apiKeys: ["roadmap-test-key"],
    builders,
    now: () => new Date("2026-10-09T10:00:00.000Z"),
  };
}

function forbiddenKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(forbiddenKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(/score|percent|percentage|progress.?count|count.?progress/i.test(key) ? [key] : []),
    ...forbiddenKeys(child),
  ]);
}

test("POST returns 202 building, then GET returns ready without seeker scoring fields", async () => {
  const api = deps();
  const posted = await handle({
    method: "POST",
    path: "/v1/roadmaps",
    headers: auth,
    body: { validationId: VALIDATION.validationId, profile: PROFILE },
  }, api);
  assert.equal(posted.status, 202);
  assert.equal(posted.body.ok, true);
  const building = posted.body.ok ? posted.body.data as BuildingRoadmap : undefined;
  assert.equal(building?.status, "building");
  assert.equal(JSON.stringify(posted.body).includes("buildPromise"), false);
  await building?.buildPromise;

  const got = await handle({ method: "GET", path: `/v1/roadmaps/${building?.roadmapId}`, headers: auth }, api);
  assert.equal(got.status, 200);
  const ready = got.body.ok ? got.body.data as Roadmap : undefined;
  assert.equal(ready?.status, "ready");
  assert.equal(ready?.modules[0]!.chapters[0]!.doneBy, "evidence");
  assert.deepEqual(forbiddenKeys(got.body), []);
});

test("progress, list, and delete routes use the shared envelope", async () => {
  const api = deps();
  const posted = await handle({
    method: "POST",
    path: "/v1/roadmaps",
    headers: auth,
    body: { validationId: VALIDATION.validationId, profile: PROFILE },
  }, api);
  const building = posted.body.ok ? posted.body.data as BuildingRoadmap : undefined;
  await building?.buildPromise;

  const progress = await handle({
    method: "PUT",
    path: `/v1/roadmaps/${building?.roadmapId}/chapters/${chapterId}/progress`,
    headers: auth,
    body: { done: false },
  }, api);
  assert.equal(progress.status, 200);
  const expected = structuredClone(planned[0]!.chapters[0]!);
  expected.resources = [resource];
  expected.topPickId = resource.resourceId;
  expected.done = false;
  delete expected.doneBy;
  assert.deepEqual(progress.body.ok && progress.body.data, expected);

  const list = await handle({ method: "GET", path: `/v1/seekers/${PROFILE.seekerId}/roadmaps?page=2`, headers: auth }, api);
  assert.equal(list.status, 200);
  assert.equal(list.body.ok && (list.body.data as Roadmap[]).length, 1);

  const removed = await handle({ method: "DELETE", path: `/v1/seekers/${PROFILE.seekerId}/roadmaps`, headers: auth }, api);
  assert.deepEqual(removed.body.ok && removed.body.data, { deleted: true, roadmaps: 1 });
});

test("authentication happens before routing and unknown validations surface as 422", async () => {
  const unauthorized = await handle({ method: "GET", path: "/v1/unknown" }, deps());
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error?.code, "unauthorized");
  assert.match(unauthorized.body.meta.requestId, /^req_/);

  const missing = await handle({
    method: "POST",
    path: "/v1/roadmaps",
    headers: auth,
    body: { validationId: VALIDATION.validationId, profile: PROFILE },
  }, deps(new FakeValidationReader([])));
  assert.equal(missing.status, 422);
  assert.deepEqual(missing.body.error, { code: "unprocessable", message: "validation not found" });
});

test("malformed IDs and unknown progress fields are rejected", async () => {
  const malformed = await handle({ method: "GET", path: "/v1/roadmaps/rmp_wrong", headers: auth }, deps());
  assert.equal(malformed.status, 404);
  assert.equal(malformed.body.error?.code, "not_found");

  const wrongMethod = await handle({ method: "DELETE", path: `/v1/roadmaps/rmp_00000000000000000000000001`, headers: auth }, deps());
  assert.equal(wrongMethod.status, 400);
  assert.equal(wrongMethod.body.error?.code, "bad_request");
});
