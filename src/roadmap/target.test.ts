import assert from "node:assert/strict";
import test from "node:test";
import type { Validation } from "./contracts.ts";
import { pickTarget } from "./target.ts";
import { VALIDATION } from "./testdata/validation.ts";

test("picks the lowest entry-level ladder step and returns only sourced validation facts", () => {
  const target = pickTarget(structuredClone(VALIDATION));

  assert.ok(target);
  assert.equal(target.step.level, "junior");
  assert.equal(target.step.title, "Junior backend developer");
  assert.ok(target.facts.some(({ statement }) => statement === "14 of 120 ads in Prague are for juniors, trainees, or people without experience."));
  assert.ok(target.facts.some(({ statement }) => statement.includes("55000 CZK")));
  assert.ok(target.facts.every(({ kind, tier, sources }) => kind === "fact" && tier === "single-source" && sources.length > 0));
  assert.deepEqual(
    target.facts.find(({ statement }) => statement.startsWith("14 of 120"))?.sources,
    VALIDATION.market[0]!.entryLevelSources,
  );
});

test("prefers entry before junior when entry-level vacancies exist", () => {
  const validation = structuredClone(VALIDATION);
  validation.jobProfile.ladder = [
    validation.jobProfile.ladder![1]!,
    { ...validation.jobProfile.ladder![0]!, level: "entry", title: "Backend developer trainee" },
    validation.jobProfile.ladder![0]!,
  ];

  assert.equal(pickTarget(validation)?.step.level, "entry");
});

test("returns undefined when the validation has no ladder", () => {
  const validation = structuredClone(VALIDATION) as Validation;
  delete validation.jobProfile.ladder;

  assert.equal(pickTarget(validation), undefined);
});

test("returns undefined without entry-level vacancies or any sourced target fact", () => {
  const noEntryVacancies = structuredClone(VALIDATION);
  noEntryVacancies.market[0]!.entryLevelVacancies = 0;
  assert.equal(pickTarget(noEntryVacancies), undefined);

  const noSourcedFact = structuredClone(VALIDATION);
  noSourcedFact.market[0]!.entryLevelSources = [];
  noSourcedFact.jobProfile.ladder![0]!.claims = [];
  assert.equal(pickTarget(noSourcedFact), undefined);
});
