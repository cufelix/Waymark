import assert from "node:assert/strict";
import test from "node:test";
import { handle, type GapDeps } from "./api.ts";
import type { SeekerProfile, Validation } from "./contracts.ts";
import { FakePart2Client } from "./part2-client.ts";
import { defaultBuilders } from "./service.ts";
import { MemoryGapStore } from "./store.ts";
import { CAREER_PATHS, COMPANIES, MARKET, PROFILE, RUN, SEEKER_RESEARCH, TRENDS, VACANCIES } from "./testdata/run.ts";

const API_KEY = "e2e-key";
const auth = { Authorization: `Bearer ${API_KEY}` };

function data<T>(response: Awaited<ReturnType<typeof handle>>): T {
  assert.equal(response.body.ok, true);
  return response.body.data as T;
}

test("real validation builders complete POST, GET, list, and delete without seeker scoring", async () => {
  assert.deepEqual(Object.keys(defaultBuilders).sort(), ["buildCompanyChecks", "buildJobProfile", "buildMarketFacts", "buildSkillChecks"]);

  const seekerId = "skr_00000000000000000000000000";
  const profile: SeekerProfile = { ...structuredClone(PROFILE), seekerId };
  const run = { ...RUN, seekerId };
  const deps: GapDeps = {
    store: new MemoryGapStore(),
    apiKeys: [API_KEY],
    part2: new FakePart2Client({
      run,
      careerPaths: CAREER_PATHS,
      market: MARKET,
      trends: [TRENDS],
      seekerResearch: SEEKER_RESEARCH,
      companies: COMPANIES,
      vacancies: VACANCIES,
    }),
  };

  const createdResponse = await handle({
    method: "POST",
    path: "/v1/validations",
    headers: auth,
    body: { profile, runId: run.runId },
  }, deps);
  assert.equal(createdResponse.status, 201);
  const created = data<Validation>(createdResponse);

  assert.deepEqual(created.skills.map(({ skill, evidence }) => [skill.label, evidence]), [
    ["Docker", "proven"],
    ["PostgreSQL", "stated"],
    ["Kubernetes", "none"],
  ]);
  assert.equal(created.companies[0]?.name, "Example Dream s.r.o.");
  assert.deepEqual(created.market.map(({ location, entryLevelVacancies }) => ({ location, entryLevelVacancies })), [{
    location: { country: "CZ", city: "Prague" },
    entryLevelVacancies: 2,
  }]);
  assert.deepEqual(created.jobProfile.skills.map(({ skill, band }) => [skill.label, band]), [
    ["Docker", "most"],
    ["Kubernetes", "most"],
    ["PostgreSQL", "most"],
  ]);

  const serialized = JSON.stringify(created);
  assert.doesNotMatch(serialized, /"[^"]*(?:score|match|percent|probability|chance)[^"]*"\s*:/i);

  const getResponse = await handle({ method: "GET", path: `/v1/validations/${created.validationId}`, headers: auth }, deps);
  assert.deepEqual(data<Validation>(getResponse), created);

  const listResponse = await handle({ method: "GET", path: `/v1/seekers/${seekerId}/validations`, headers: auth }, deps);
  assert.deepEqual(data<Validation[]>(listResponse), [created]);

  const deleteResponse = await handle({ method: "DELETE", path: `/v1/seekers/${seekerId}/validations`, headers: auth }, deps);
  assert.deepEqual(data(deleteResponse), { deleted: true, validations: 1 });

  const emptyList = await handle({ method: "GET", path: `/v1/seekers/${seekerId}/validations`, headers: auth }, deps);
  assert.deepEqual(data<Validation[]>(emptyList), []);
});
