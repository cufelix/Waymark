import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../seeker/core/errors.ts";
import { FakeLlm } from "../seeker/llm/llm.ts";
import type { LearningResource, RoadmapChapter, RoadmapModule } from "./contracts.ts";
import { MemoryResourceCache } from "./resources.ts";
import {
  createRoadmap,
  deleteRoadmaps,
  getRoadmap,
  listRoadmaps,
  setProgress,
  type RoadmapBuilders,
  type RoadmapDeps,
} from "./service.ts";
import { MemoryRoadmapStore } from "./store.ts";
import { PROFILE, SQL, VALIDATION } from "./testdata/validation.ts";
import { FakeValidationReader } from "./validation-client.ts";

const NOW = new Date("2026-10-09T10:00:00.000Z");
const RESOURCE: LearningResource = {
  resourceId: "res_00000000000000000000000001",
  title: "Example SQL review",
  provider: "Example Learning",
  url: "https://example.com/learn/sql-review",
  format: "course",
  cost: "free",
  lang: "en",
  source: {
    id: "src_00000000000000000000000020",
    url: "https://example.com/learn/sql-review",
    title: "Example SQL review",
    fetchedAt: NOW.toISOString(),
    tool: "exa",
    quote: "Review SQL queries with free exercises.",
    contentHash: "a".repeat(64),
  },
};

function evidenceChapter(id = "chp_00000000000000000000000001"): RoadmapChapter {
  const check = VALIDATION.skills.find(({ skill }) => skill.uri === SQL.uri)!;
  return {
    chapterId: id,
    title: "SQL queries",
    category: "data",
    skills: [SQL],
    demand: {
      vacanciesRequiring: check.demand.vacanciesRequiring,
      vacanciesTotal: check.demand.vacanciesTotal,
      sources: structuredClone(check.demand.sources),
    },
    evidence: "stated",
    claims: structuredClone(check.claims),
    outcome: "Write and review useful queries",
    resources: [],
    done: true,
    doneBy: "evidence",
  };
}

function modules(chapters = [evidenceChapter()]): RoadmapModule[] {
  return [{
    moduleId: "mod_00000000000000000000000001",
    title: "Data foundations",
    subtitle: "Queries and storage",
    why: "Start with practical data work",
    chapters,
  }];
}

function fakeBuilders(planned = modules()): RoadmapBuilders {
  return {
    pickTarget: () => undefined,
    planModules: async () => structuredClone(planned),
    findResources: async () => ({ resources: [structuredClone(RESOURCE)], topPickId: RESOURCE.resourceId }),
  };
}

function deps(store = new MemoryRoadmapStore(), validations = new FakeValidationReader([VALIDATION])): RoadmapDeps {
  return {
    store,
    validations,
    llm: new FakeLlm([]),
    exa: null,
    cache: new MemoryResourceCache(),
    now: () => new Date(NOW),
  };
}

const request = () => ({ validationId: VALIDATION.validationId, profile: structuredClone(PROFILE) });

test("createRoadmap stores building first, completes in the background, and preserves evidence completion", async () => {
  const service = deps();
  const created = await createRoadmap(service, request(), fakeBuilders());
  assert.equal(created.status, "building");
  assert.deepEqual(created.modules, []);
  assert.match(created.roadmapId, /^rmp_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(Object.keys(created).includes("buildPromise"), false);
  assert.equal(JSON.stringify(created).includes("buildPromise"), false);
  assert.equal((await getRoadmap(service, created.roadmapId)).status, "building");

  await created.buildPromise;
  const ready = await getRoadmap(service, created.roadmapId);
  assert.equal(ready.status, "ready");
  assert.equal(ready.modules[0]!.chapters[0]!.done, true);
  assert.equal(ready.modules[0]!.chapters[0]!.doneBy, "evidence");
  assert.equal(ready.modules[0]!.chapters[0]!.doneAt, undefined);
  assert.deepEqual(ready.modules[0]!.chapters[0]!.resources, [RESOURCE]);
  assert.equal(ready.modules[0]!.chapters[0]!.topPickId, RESOURCE.resourceId);
});

test("a background failure stores a failed roadmap without exposing its message", async () => {
  const secret = "provider-key-must-stay-private";
  const builders = fakeBuilders();
  builders.planModules = async () => {
    throw new ApiError("upstream_failed", `provider rejected ${secret}`);
  };
  const service = deps();
  const created = await createRoadmap(service, request(), builders);
  await created.buildPromise;

  const failed = await getRoadmap(service, created.roadmapId);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error?.code, "upstream_failed");
  assert.equal(failed.error?.message.includes(secret), false);
  assert.deepEqual(failed.modules, []);
});

test("unknown and foreign validations are unprocessable and request fields are exact", async () => {
  await assert.rejects(() => createRoadmap(deps(undefined, new FakeValidationReader([])), request(), fakeBuilders()), (error) => (
    error instanceof ApiError && error.code === "unprocessable" && error.message === "validation not found"
  ));

  const foreign = structuredClone(VALIDATION);
  foreign.seekerId = "skr_00000000000000000000000002";
  await assert.rejects(() => createRoadmap(deps(undefined, new FakeValidationReader([foreign])), request(), fakeBuilders()), (error) => (
    error instanceof ApiError && error.code === "unprocessable"
  ));

  await assert.rejects(() => createRoadmap(deps(), { ...request(), extra: true } as never, fakeBuilders()), (error) => (
    error instanceof ApiError && error.code === "unprocessable" && error.message.includes("Unknown field")
  ));
});

test("progress ticks are seeker-owned and un-ticking clears evidence and seeker completion metadata", async () => {
  const service = deps();
  const created = await createRoadmap(service, request(), fakeBuilders());
  await created.buildPromise;
  const chapterId = evidenceChapter().chapterId;

  const cleared = await setProgress(service, created.roadmapId, chapterId, { done: false });
  assert.equal(cleared.done, false);
  assert.equal(cleared.doneBy, undefined);
  assert.equal(cleared.doneAt, undefined);

  const ticked = await setProgress(service, created.roadmapId, chapterId, { done: true });
  assert.equal(ticked.done, true);
  assert.equal(ticked.doneBy, "seeker");
  assert.equal(ticked.doneAt, NOW.toISOString());

  await assert.rejects(() => setProgress(service, created.roadmapId, chapterId, { done: true, extra: true } as never), (error) => (
    error instanceof ApiError && error.code === "unprocessable"
  ));
  await assert.rejects(() => setProgress(service, created.roadmapId, "chp_00000000000000000000000009", { done: true }), (error) => (
    error instanceof ApiError && error.code === "not_found"
  ));
});

test("progress conflicts while building", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const builders = fakeBuilders();
  builders.planModules = async () => {
    await wait;
    return modules();
  };
  const service = deps();
  const created = await createRoadmap(service, request(), builders);
  await assert.rejects(() => setProgress(service, created.roadmapId, evidenceChapter().chapterId, { done: true }), (error) => (
    error instanceof ApiError && error.code === "conflict"
  ));
  release();
  await created.buildPromise;
});

test("resource discovery runs at no more than four chapters concurrently", async () => {
  const planned = modules(Array.from({ length: 9 }, (_, index) => evidenceChapter(`chp_${String(index + 1).padStart(26, "0")}`)));
  let active = 0;
  let maximum = 0;
  const builders = fakeBuilders(planned);
  builders.findResources = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    active--;
    return { resources: [] };
  };
  const service = deps();
  const created = await createRoadmap(service, request(), builders);
  await created.buildPromise;
  assert.equal((await getRoadmap(service, created.roadmapId)).status, "ready");
  assert.equal(maximum, 4);
});

test("list and delete are seeker-scoped", async () => {
  const service = deps();
  const first = await createRoadmap(service, request(), fakeBuilders());
  const second = await createRoadmap(service, request(), fakeBuilders());
  await Promise.all([first.buildPromise, second.buildPromise]);

  assert.deepEqual((await listRoadmaps(service, PROFILE.seekerId)).map(({ roadmapId }) => roadmapId), [first.roadmapId, second.roadmapId]);
  assert.deepEqual(await deleteRoadmaps(service, PROFILE.seekerId), { deleted: true, roadmaps: 2 });
  assert.deepEqual(await listRoadmaps(service, PROFILE.seekerId), []);
});
