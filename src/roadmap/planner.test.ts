import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../seeker/core/errors.ts";
import { FakeLlm, MODELS } from "../seeker/llm/llm.ts";
import type { RoadmapChapter } from "./contracts.ts";
import { planModules } from "./planner.ts";
import { DOCKER, GIT, PROFILE, PYTHON, SQL, VALIDATION } from "./testdata/validation.ts";

function answer(chapters: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    modules: [{
      title: "Backend foundations",
      subtitle: "Core employer skills",
      why: "Start with prerequisites before combining the tools.",
      chapters,
      ...overrides,
    }],
  });
}

const chapter = (title: string, category: RoadmapChapter["category"], skillUris: string[], outcome: string) => ({
  title,
  category,
  skillUris,
  outcome,
});

const completeReply = () => answer([
  chapter("How backend services fit together", "theory", [], "Explain the parts of a backend service."),
  chapter("Python practice", "code", [PYTHON.uri], "Build a small backend task with Python."),
  chapter("SQL practice", "data", [SQL.uri], "Query stored application data with SQL."),
  chapter("Docker practice", "tools", [DOCKER.uri], "Package a backend service with Docker."),
  chapter("Git practice", "tools", [GIT.uri], "Use Git while developing a small change."),
]);

function allChapters(modules: Awaited<ReturnType<typeof planModules>>): RoadmapChapter[] {
  return modules.flatMap(({ chapters }) => chapters);
}

function bySkill(chapters: RoadmapChapter[], uri: string): RoadmapChapter {
  const found = chapters.find(({ skills }) => skills.some((skill) => skill.uri === uri));
  assert.ok(found, `missing chapter for ${uri}`);
  return found;
}

test("plans modules with the fast model and copies validation facts", async () => {
  const llm = new FakeLlm([completeReply()]);
  const modules = await planModules(structuredClone(VALIDATION), structuredClone(PROFILE), { llm });
  const chapters = allChapters(modules);
  const python = bySkill(chapters, PYTHON.uri);

  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0]?.model, MODELS.fast);
  assert.equal(llm.calls[0]?.json, true);
  assert.match(llm.calls[0]?.messages[1]?.content as string, /"goal":"learn-fast"/);
  assert.match(llm.calls[0]?.messages[1]?.content as string, /"vacanciesRequiring":72/);
  assert.match(modules[0]!.moduleId, /^mod_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.match(python.chapterId, /^chp_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.deepEqual(python.demand, {
    vacanciesRequiring: VALIDATION.skills[0]!.demand.vacanciesRequiring,
    vacanciesTotal: VALIDATION.skills[0]!.demand.vacanciesTotal,
    sources: VALIDATION.skills[0]!.demand.sources,
  });
  assert.deepEqual(python.resources, []);
});

test("passes weekly study time and education to the planner as scope context", async () => {
  const llm = new FakeLlm([completeReply()]);
  const profile = structuredClone(PROFILE);
  profile.preferences.hoursPerWeek = "under-5";
  profile.preferences.education = "none";

  await planModules(VALIDATION, profile, { llm });

  const system = llm.calls[0]!.messages[0]!.content as string;
  const context = JSON.parse(llm.calls[0]!.messages[1]!.content as string) as Record<string, unknown>;
  assert.equal(context.hoursPerWeek, "under-5");
  assert.equal(context.education, "none");
  assert.match(system, /under-5.*fewer, smaller chapters/);
  assert.match(system, /education.*start from basics/);
  assert.match(system, /estimatedHours.*only numeric time/);
});

test("drops unknown skill URIs without inventing a skill or demand", async () => {
  const llm = new FakeLlm([answer([
    chapter("Unknown foundation", "theory", ["https://example.com/not-an-esco-skill"], "Understand a useful foundation."),
    chapter("Python practice", "code", [PYTHON.uri], "Use Python in a practical task."),
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a practical task."),
  ])]);

  const chapters = allChapters(await planModules(VALIDATION, PROFILE, { llm }));
  const unknown = chapters.find(({ title }) => title === "Unknown foundation")!;
  assert.deepEqual(unknown.skills, []);
  assert.equal(unknown.demand, undefined);
  assert.equal(unknown.evidence, "none");
  assert.equal(unknown.done, false);
  assert.equal(unknown.doneBy, undefined);
  assert.ok(chapters.flatMap(({ skills }) => skills).every(({ uri }) => uri !== "https://example.com/not-an-esco-skill"));
});

test("adds a fallback chapter for a missing most-demanded skill", async () => {
  const llm = new FakeLlm([answer([
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a practical task."),
  ])]);

  const chapters = allChapters(await planModules(VALIDATION, PROFILE, { llm }));
  const fallback = bySkill(chapters, PYTHON.uri);
  assert.equal(fallback.title, "Python practice");
  assert.equal(fallback.category, "project");
  assert.deepEqual(fallback.demand?.sources, VALIDATION.skills[0]!.demand.sources);
  assert.equal(fallback.done, false);
});

test("does not turn every many-band skill into a fallback chapter", async () => {
  const llm = new FakeLlm([answer([
    chapter("Python practice", "code", [PYTHON.uri], "Use Python in a practical task."),
  ])]);

  const chapters = allChapters(await planModules(VALIDATION, PROFILE, { llm }));
  assert.ok(bySkill(chapters, PYTHON.uri));
  assert.equal(chapters.some(({ skills }) => skills.some(({ uri }) => uri === SQL.uri)), false);
});

test("caps learn-fast plans even when the model returns too many chapters", async () => {
  const chapters = Array.from({ length: 15 }, (_, index) =>
    chapter(`Practice topic ${index}`, "project", [], "Complete a practical task."));
  const llm = new FakeLlm([answer(chapters), answer(chapters)]);

  const modules = await planModules(VALIDATION, PROFILE, { llm });

  assert.equal(allChapters(modules).length, 8);
  assert.match(llm.calls[0]!.messages[0]!.content as string, /chapterLimit/);
  assert.match(llm.calls[0]!.messages[0]!.content as string, /one coherent learning route/);
  assert.match(llm.calls[0]!.messages[1]!.content as string, /"chapterLimit":8/);
});

test("keeps a most-demanded skill when it appears after the learn-fast cap", async () => {
  const chapters = [
    ...Array.from({ length: 8 }, () => chapter("Foundation", "theory", [], "Understand a useful foundation.")),
    chapter("Python practice", "code", [PYTHON.uri], "Use Python in a practical task."),
  ];

  const planned = allChapters(await planModules(VALIDATION, PROFILE, { llm: new FakeLlm([answer(chapters)]) }));

  assert.equal(planned.length, 8);
  assert.ok(bySkill(planned, PYTHON.uri));
});

test("reserves a capped slot for an omitted most-demanded fallback", async () => {
  const chapters = Array.from({ length: 8 }, () =>
    chapter("Foundation", "theory", [], "Understand a useful foundation."));

  const planned = allChapters(await planModules(VALIDATION, PROFILE, { llm: new FakeLlm([answer(chapters)]) }));

  assert.equal(planned.length, 8);
  assert.ok(bySkill(planned, PYTHON.uri));
});

test("retries unsupported free-text numbers, then removes offending sentences", async () => {
  const first = answer([
    chapter("Python practice", "code", [PYTHON.uri], "Build a Python task."),
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a task."),
  ], { why: "Become productive in 7 days. Start with prerequisites." });
  const second = answer([
    chapter("Python practice", "code", [PYTHON.uri], "Build a Python task in 9 days. Practice with feedback."),
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a task."),
  ], { why: "Become productive in 9 days. Start with prerequisites." });
  const llm = new FakeLlm([first, second]);

  const modules = await planModules(VALIDATION, PROFILE, { llm });
  assert.equal(llm.calls.length, 2);
  assert.match(llm.calls[1]?.messages.at(-1)?.content as string, /introduced a digit/);
  assert.equal(llm.calls[1]?.messages.at(-2)?.content, first);
  assert.equal(modules[0]!.why, "Start with prerequisites.");
  assert.equal(bySkill(allChapters(modules), PYTHON.uri).outcome, "Practice with feedback.");
  assert.doesNotMatch(JSON.stringify(modules), /productive in [79] days|task in [79] days/);
});

test("retries and strips forbidden seeker summaries even when their numbers are allowed demand facts", async () => {
  const forbidden = "You have a 72% chance and are likely at level 72 with 72 of 120 modules plus XP.";
  const first = answer([
    chapter("Python practice", "code", [PYTHON.uri], `${forbidden} Build a Python task.`),
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a task."),
  ], { why: `Pravděpodobnost and šance are not facts. ${forbidden} Start with prerequisites.` });
  const second = answer([
    chapter("Python practice", "code", [PYTHON.uri], `${forbidden} Practice with feedback.`),
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a task."),
  ], { why: `${forbidden} Start with prerequisites.` });
  const llm = new FakeLlm([first, second]);

  const modules = await planModules(VALIDATION, PROFILE, { llm });
  assert.equal(llm.calls.length, 2);
  assert.equal(modules[0]!.why, "Start with prerequisites.");
  assert.equal(bySkill(allChapters(modules), PYTHON.uri).outcome, "Practice with feedback.");
  assert.doesNotMatch(JSON.stringify(modules), /%|probability|chance|likely|šance|pravděpodobnost|\blevel\s+\d|\bXP\b|\d+ of \d+ modules/iu);
});

test("strips score, fit, skill-match, percent and probability summaries without removing demand facts or ordinary match prose", async () => {
  const unsafe = answer([
    chapter(
      "Python practice",
      "code",
      [PYTHON.uri],
      "Your skill match probability is high. Match the design to the requirements.",
    ),
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a task."),
  ], {
    why: "Your fit score and percent are strong. Employer demand includes 72 of 120 vacancies.",
  });
  const llm = new FakeLlm([unsafe, unsafe]);

  const modules = await planModules(VALIDATION, PROFILE, { llm });

  assert.equal(llm.calls.length, 2);
  assert.equal(modules[0]!.why, "Employer demand includes 72 of 120 vacancies.");
  assert.equal(bySkill(allChapters(modules), PYTHON.uri).outcome, "Match the design to the requirements.");
  assert.doesNotMatch(JSON.stringify(modules), /\b(?:score|fit score|skill match|percent|probability)\b/iu);
});

test("strips N-of-M seeker skill totals while preserving N-of-M employer-ad demand", async () => {
  const unsafe = answer([
    chapter(
      "Python practice",
      "code",
      [PYTHON.uri],
      "You already have 72 of 120 skills. Employer demand shows 72 of 120 ads ask for Python.",
    ),
    chapter("SQL practice", "data", [SQL.uri], "Use SQL in a task."),
  ], { why: "You cover 72 of 120 requirements. Follow employer demand." });
  const llm = new FakeLlm([unsafe, unsafe]);

  const modules = await planModules(VALIDATION, PROFILE, { llm });

  assert.equal(llm.calls.length, 2);
  assert.equal(modules[0]!.why, "Follow employer demand.");
  assert.equal(
    bySkill(allChapters(modules), PYTHON.uri).outcome,
    "Employer demand shows 72 of 120 ads ask for Python.",
  );
  assert.doesNotMatch(JSON.stringify(modules), /72 of 120 (?:skills|requirements)/iu);
});

test("retries the first planner request once after a transport failure", async () => {
  const calls: unknown[] = [];
  const llm = {
    async chat(request: unknown): Promise<string> {
      calls.push(request);
      if (calls.length === 1) throw new ApiError("upstream_failed", "temporary provider failure");
      return completeReply();
    },
  };

  const modules = await planModules(VALIDATION, PROFILE, { llm });
  assert.equal(calls.length, 2);
  assert.ok(bySkill(allChapters(modules), PYTHON.uri));

  let failedCalls = 0;
  await assert.rejects(() => planModules(VALIDATION, PROFILE, {
    llm: {
      async chat(): Promise<string> {
        failedCalls++;
        throw new ApiError("upstream_failed", "provider unavailable");
      },
    },
  }), (error) => error instanceof ApiError && error.code === "upstream_failed");
  assert.equal(failedCalls, 2);
});

test("copies weakest evidence and starts only fully known chapters as done by evidence", async () => {
  const llm = new FakeLlm([answer([
    chapter("Foundation", "theory", [], "Understand a backend foundation."),
    chapter("SQL practice", "data", [SQL.uri], "Review SQL in a practical task."),
    chapter("Git practice", "tools", [GIT.uri], "Review Git in a practical task."),
    chapter("Python and SQL", "project", [PYTHON.uri, SQL.uri], "Combine Python and SQL in a practical task."),
    chapter("Docker practice", "tools", [DOCKER.uri], "Use Docker in a practical task."),
  ])]);

  const chapters = allChapters(await planModules(VALIDATION, PROFILE, { llm }));
  const foundation = chapters.find(({ title }) => title === "Foundation")!;
  const sql = bySkill(chapters.filter(({ title }) => title === "SQL practice"), SQL.uri);
  const git = bySkill(chapters, GIT.uri);
  const mixed = chapters.find(({ title }) => title === "Python and SQL")!;
  const docker = bySkill(chapters, DOCKER.uri);

  assert.deepEqual({ evidence: sql.evidence, claims: sql.claims, done: sql.done, doneBy: sql.doneBy }, {
    evidence: "stated",
    claims: VALIDATION.skills[1]!.claims,
    done: true,
    doneBy: "evidence",
  });
  assert.deepEqual({ evidence: git.evidence, claims: git.claims, done: git.done, doneBy: git.doneBy }, {
    evidence: "proven",
    claims: VALIDATION.skills[3]!.claims,
    done: true,
    doneBy: "evidence",
  });
  for (const notKnown of [foundation, mixed, docker]) {
    assert.equal(notKnown.done, false);
    assert.equal(notKnown.doneBy, undefined);
  }
  assert.equal(mixed.evidence, "none");
});

test("does not expose seeker scores, progress, XP, or numeric levels", async () => {
  const modules = await planModules(VALIDATION, PROFILE, { llm: new FakeLlm([completeReply()]) });
  const forbidden = new Set(["score", "percent", "progress", "xp", "level"]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, `forbidden key: ${key}`);
      visit(child);
    }
  };
  visit(modules);
});

test("throws upstream_failed after one retry of malformed output", async () => {
  const llm = new FakeLlm(["not JSON", JSON.stringify({ modules: [] })]);

  await assert.rejects(
    () => planModules(VALIDATION, PROFILE, { llm }),
    (error) => error instanceof ApiError && error.code === "upstream_failed",
  );
  assert.equal(llm.calls.length, 2);
});

test("odds words are fine in prose, only a prediction about getting hired is stripped", async () => {
  const llm = new FakeLlm([answer([
    chapter("Python practice", "code", [PYTHON.uri], "This gives you a chance to practise loops. You will likely enjoy it."),
    chapter("SQL practice", "data", [SQL.uri], "You have a good chance of getting hired. Use SQL in a task."),
  ], { why: "Start with prerequisites." }), answer([
    chapter("Python practice", "code", [PYTHON.uri], "This gives you a chance to practise loops. You will likely enjoy it."),
    chapter("SQL practice", "data", [SQL.uri], "You have a good chance of getting hired. Use SQL in a task."),
  ], { why: "Start with prerequisites." })]);

  const modules = await planModules(VALIDATION, PROFILE, { llm });
  const chapters = allChapters(modules);
  assert.equal(bySkill(chapters, PYTHON.uri).outcome, "This gives you a chance to practise loops. You will likely enjoy it.");
  assert.equal(bySkill(chapters, SQL.uri).outcome, "Use SQL in a task.");
});
