import assert from "node:assert/strict";
import test from "node:test";
import { FakeLlm } from "../seeker/llm/llm.ts";
import { FakeExa } from "../seeker/salary/exa.ts";
import { handle, type RoadmapApiDeps } from "./api.ts";
import type { Roadmap, RoadmapChapter } from "./contracts.ts";
import { MemoryResourceCache } from "./resources.ts";
import type { BuildingRoadmap } from "./service.ts";
import { MemoryRoadmapStore } from "./store.ts";
import { DOCKER, EXA_PAGES, GIT, PROFILE, PYTHON, SQL, VALIDATION } from "./testdata/validation.ts";
import { FakeValidationReader } from "./validation-client.ts";

const AUTH = { Authorization: "Bearer roadmap-e2e-key" };
const NOW = new Date("2026-10-09T11:00:00.000Z");

function plannerReply(): string {
  return JSON.stringify({
    modules: [{
      title: "Backend foundations",
      subtitle: "Core employer skills",
      why: "Build the prerequisites before combining the tools.",
      chapters: [
        { title: "Python practice", category: "code", skillUris: [PYTHON.uri], outcome: "Build a backend task with Python." },
        { title: "SQL practice", category: "data", skillUris: [SQL.uri], outcome: "Query application data with SQL." },
        { title: "Docker practice", category: "tools", skillUris: [DOCKER.uri], outcome: "Package a backend service with Docker." },
        { title: "Git practice", category: "tools", skillUris: [GIT.uri], outcome: "Use Git while developing a change." },
      ],
    }],
  });
}

function resourceReply(): string {
  return JSON.stringify({
    resources: [{
      pageIndex: 0,
      title: "Python basics course",
      provider: "Python",
      format: "course",
      cost: "free",
      level: "beginner",
      lang: "en",
      quote: "This beginner Python basics course is free.",
    }],
  });
}

function chapterFor(roadmap: Roadmap, uri: string): RoadmapChapter {
  const chapter = roadmap.modules.flatMap(({ chapters }) => chapters)
    .find(({ skills }) => skills.some((skill) => skill.uri === uri));
  assert.ok(chapter, `missing chapter for ${uri}`);
  return chapter;
}

function assertNoSeekerSummary(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoSeekerSummary);
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    assert.equal(/score|match|percent|probability|chance/.test(lower) || lower === "xp", false, `forbidden key: ${key}`);
    assert.equal(/progress.*count|count.*progress/.test(lower), false, `forbidden progress count key: ${key}`);
    if (lower === "level") assert.notEqual(typeof child, "number", "numeric level is forbidden");
    assertNoSeekerSummary(child);
  }
}

test("real roadmap builders complete the API lifecycle with sourced facts and guarded progress", async () => {
  const llm = new FakeLlm([plannerReply(), resourceReply(), resourceReply(), resourceReply(), resourceReply()]);
  const api: RoadmapApiDeps = {
    store: new MemoryRoadmapStore(),
    validations: new FakeValidationReader([VALIDATION]),
    llm,
    exa: new FakeExa(EXA_PAGES),
    cache: new MemoryResourceCache(),
    apiKeys: ["roadmap-e2e-key"],
    now: () => new Date(NOW),
  };

  const posted = await handle({
    method: "POST",
    path: "/v1/roadmaps",
    headers: AUTH,
    body: { validationId: VALIDATION.validationId, profile: PROFILE },
  }, api);
  assert.equal(posted.status, 202);
  const building = posted.body.ok ? posted.body.data as BuildingRoadmap : undefined;
  assert.equal(building?.status, "building");
  await building?.buildPromise;

  const got = await handle({ method: "GET", path: `/v1/roadmaps/${building?.roadmapId}`, headers: AUTH }, api);
  assert.equal(got.status, 200);
  assert.ok(got.body.ok);
  const ready = got.body.data as Roadmap;
  assert.equal(ready.status, "ready");
  assert.ok(ready.target && ready.target.facts.length > 0);
  assert.equal(ready.target.step.title, VALIDATION.jobProfile.ladder![0]!.title);
  assert.ok(ready.target.facts.every(({ sources }) => sources.length > 0));

  const python = chapterFor(ready, PYTHON.uri);
  const sql = chapterFor(ready, SQL.uri);
  const docker = chapterFor(ready, DOCKER.uri);
  const git = chapterFor(ready, GIT.uri);
  assert.deepEqual([sql.done, sql.doneBy, git.done, git.doneBy], [true, "evidence", true, "evidence"]);
  assert.deepEqual([python.done, python.doneBy, docker.done, docker.doneBy], [false, undefined, false, undefined]);

  for (const chapter of ready.modules.flatMap(({ chapters }) => chapters)) {
    const check = VALIDATION.skills.find(({ skill }) => skill.uri === chapter.skills[0]?.uri);
    assert.ok(check);
    assert.deepEqual(chapter.demand, {
      vacanciesRequiring: check.demand.vacanciesRequiring,
      vacanciesTotal: check.demand.vacanciesTotal,
      sources: check.demand.sources,
    });
    assert.ok(chapter.resources.length > 0);
    for (const resource of chapter.resources) {
      assert.equal(resource.source.tool, "exa");
      const page = EXA_PAGES.find(({ url }) => url === resource.source.url);
      assert.ok(page && resource.source.quote && page.text.includes(resource.source.quote));
    }
  }
  assertNoSeekerSummary(got.body);

  const ticked = await handle({
    method: "PUT",
    path: `/v1/roadmaps/${ready.roadmapId}/chapters/${python.chapterId}/progress`,
    headers: AUTH,
    body: { done: true },
  }, api);
  assert.ok(ticked.body.ok);
  assert.equal((ticked.body.data as RoadmapChapter).doneBy, "seeker");
  assert.equal((ticked.body.data as RoadmapChapter).doneAt, NOW.toISOString());

  const unticked = await handle({
    method: "PUT",
    path: `/v1/roadmaps/${ready.roadmapId}/chapters/${git.chapterId}/progress`,
    headers: AUTH,
    body: { done: false },
  }, api);
  assert.ok(unticked.body.ok);
  assert.deepEqual({
    done: (unticked.body.data as RoadmapChapter).done,
    doneBy: (unticked.body.data as RoadmapChapter).doneBy,
    doneAt: (unticked.body.data as RoadmapChapter).doneAt,
  }, { done: false, doneBy: undefined, doneAt: undefined });

  const listed = await handle({ method: "GET", path: `/v1/seekers/${PROFILE.seekerId}/roadmaps`, headers: AUTH }, api);
  assert.equal(listed.body.ok && (listed.body.data as Roadmap[]).length, 1);
  const deleted = await handle({ method: "DELETE", path: `/v1/seekers/${PROFILE.seekerId}/roadmaps`, headers: AUTH }, api);
  assert.deepEqual(deleted.body.ok && deleted.body.data, { deleted: true, roadmaps: 1 });
  const empty = await handle({ method: "GET", path: `/v1/seekers/${PROFILE.seekerId}/roadmaps`, headers: AUTH }, api);
  assert.equal(empty.body.ok && (empty.body.data as Roadmap[]).length, 0);
});
