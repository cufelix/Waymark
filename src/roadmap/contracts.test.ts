import assert from "node:assert/strict";
import test from "node:test";
import { validateSeekerProfile } from "../seeker/core/validate.ts";
import { EXA_PAGES, PROFILE, VALIDATION } from "./testdata/validation.ts";

test("PROFILE is a complete, contract-valid seeker profile for the validation", () => {
  const profile = validateSeekerProfile(PROFILE);
  assert.deepEqual(profile, PROFILE);
  assert.equal(profile.status, "complete");
  assert.equal(profile.preferences.goal, "learn-fast");
  assert.deepEqual(profile.preferences.languages, [
    { lang: "en", level: "fluent" },
    { lang: "cs", level: "native" },
  ]);
  assert.equal(VALIDATION.seekerId, profile.seekerId);
  assert.equal(VALIDATION.profileVersion, profile.profileVersion);
});

test("VALIDATION exposes the demand, evidence, ladder and market facts roadmap workers need", () => {
  assert.equal(VALIDATION.occupation.label, "backend developer");
  assert.deepEqual(VALIDATION.jobProfile.skills.map(({ skill, band }) => [skill.label, band]), [
    ["Python", "most"],
    ["SQL", "many"],
    ["Docker", "some"],
    ["Git", "some"],
  ]);
  assert.deepEqual(VALIDATION.skills.map(({ skill, evidence }) => [skill.label, evidence]), [
    ["Python", "none"],
    ["SQL", "stated"],
    ["Docker", "none"],
    ["Git", "proven"],
  ]);
  assert.deepEqual(VALIDATION.jobProfile.ladder?.map(({ level, title }) => [level, title]), [
    ["junior", "Junior backend developer"],
    ["mid", "Backend developer"],
  ]);
  assert.ok((VALIDATION.jobProfile.ladder?.[0]?.salary?.sampleSize ?? 0) > 0);
  assert.ok(VALIDATION.market[0]!.entryLevelVacancies > 0);
  assert.ok(VALIDATION.market[0]!.entryLevelSources.length > 0);
  assert.equal(EXA_PAGES.length, 3);
  assert.ok(EXA_PAGES.some(({ text }) => text.includes("free")));
  assert.ok(EXA_PAGES.some(({ text }) => text.includes("EUR 24")));
});
