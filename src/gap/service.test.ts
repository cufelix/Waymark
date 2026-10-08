import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../seeker/core/errors.ts";
import type { Occupation, SeekerProfile, ValidationRequest } from "./contracts.ts";
import { FakePart2Client } from "./part2-client.ts";
import { createValidation, deleteValidations, getValidation, listValidations, type ValidationBuilders } from "./service.ts";
import { MemoryGapStore } from "./store.ts";
import { CAREER_PATHS, COMPANIES, MARKET, OCC, PROFILE, RUN, SEEKER_RESEARCH, TRENDS, VACANCIES } from "./testdata/run.ts";

const SEEKER_ID = "skr_00000000000000000000000000";
const VALID_PROFILE: SeekerProfile = (() => {
  const profile = structuredClone(PROFILE);
  profile.seekerId = SEEKER_ID;
  const claim = profile.statedSkills[0]!;
  claim.id = "clm_00000000000000000000000000";
  claim.subject.id = SEEKER_ID;
  claim.sources[0]!.id = "src_00000000000000000000000000";
  claim.sources[0]!.url = "seeker-upload://doc_00000000000000000000000000";
  return profile;
})();
const VALID_RUN = { ...RUN, seekerId: SEEKER_ID };

const builders: ValidationBuilders = {
  buildJobProfile: ({ occupation, vacancies, market, careerPath }) => ({
    occupation,
    vacanciesAnalysed: vacancies.length,
    markets: market.map((entry) => ({ ...entry.location, vacancies: entry.vacancyCount })),
    skills: [],
    ...(careerPath?.ladder ? { ladder: careerPath.ladder } : {}),
  }),
  buildSkillChecks: () => [],
  buildCompanyChecks: () => [],
  buildMarketFacts: ({ locations }) => locations.map((location) => ({ location, openVacancies: 0, entryLevelVacancies: 0, entryLevelSources: [], repostedVacancies: 0 })),
};

function part2(overrides: Partial<ConstructorParameters<typeof FakePart2Client>[0]> = {}): FakePart2Client {
  return new FakePart2Client({
    run: VALID_RUN,
    careerPaths: CAREER_PATHS,
    market: MARKET,
    trends: [TRENDS],
    seekerResearch: SEEKER_RESEARCH,
    companies: COMPANIES,
    vacancies: VACANCIES,
    ...overrides,
  });
}

function request(overrides: Partial<ValidationRequest> = {}): ValidationRequest {
  return { profile: structuredClone(VALID_PROFILE), runId: VALID_RUN.runId, ...overrides };
}

async function expectApiError(action: () => Promise<unknown>, code: ApiError["code"]): Promise<void> {
  await assert.rejects(action, (error) => error instanceof ApiError && error.code === code);
}

test("creates and stores a validation from a finished run", async () => {
  const store = new MemoryGapStore();
  const validation = await createValidation({ store, part2: part2() }, request(), builders);

  assert.match(validation.validationId, /^val_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(validation.seekerId, VALID_PROFILE.seekerId);
  assert.equal(validation.runId, VALID_RUN.runId);
  assert.deepEqual(validation.occupation, OCC);
  assert.deepEqual(validation.locations, VALID_PROFILE.preferences.locations);
  assert.equal(validation.jobProfile.vacanciesAnalysed, VACANCIES.length);
  assert.deepEqual(await store.get(validation.validationId), validation);
});

test("rejects another seeker's, unfinished, and unknown runs", async () => {
  const store = new MemoryGapStore();
  await expectApiError(
    () => createValidation({ store, part2: part2({ run: { ...VALID_RUN, seekerId: "skr_11111111111111111111111111" } }) }, request(), builders),
    "unprocessable",
  );
  await expectApiError(
    () => createValidation({ store, part2: part2({ run: { ...VALID_RUN, status: "running" } }) }, request(), builders),
    "conflict",
  );
  await expectApiError(
    () => createValidation({ store, part2: part2() }, request({ runId: "run_UNKNOWN" }), builders),
    "unprocessable",
  );
});

test("rejects incomplete profiles, unknown occupations, and unknown request fields", async () => {
  const store = new MemoryGapStore();
  await expectApiError(
    () => createValidation({ store, part2: part2() }, request({ profile: { ...VALID_PROFILE, status: "incomplete" } }), builders),
    "unprocessable",
  );
  await expectApiError(
    () => createValidation({ store, part2: part2() }, request({ occupationUri: "http://data.europa.eu/esco/occupation/unknown" }), builders),
    "unprocessable",
  );
  await expectApiError(
    () => createValidation({ store, part2: part2() }, { ...request(), extra: true } as ValidationRequest, builders),
    "unprocessable",
  );
});

test("rejects missing, wrongly typed, and unknown top-level profile fields", async () => {
  const store = new MemoryGapStore();
  const requiredFields = ["seekerId", "profileVersion", "status", "consent", "preferences", "statedSkills", "documents", "links", "updatedAt"];
  for (const field of requiredFields) {
    const profile = structuredClone(VALID_PROFILE) as unknown as Record<string, unknown>;
    delete profile[field];
    await expectApiError(
      () => createValidation({ store, part2: part2() }, request({ profile: profile as unknown as SeekerProfile }), builders),
      "unprocessable",
    );
  }

  const invalidProfiles: Record<string, unknown>[] = [
    { ...VALID_PROFILE, seekerId: 1 },
    { ...VALID_PROFILE, profileVersion: "3" },
    { ...VALID_PROFILE, consent: { dataProcessing: false } },
    { ...VALID_PROFILE, preferences: [] },
    { ...VALID_PROFILE, statedSkills: {} },
    { ...VALID_PROFILE, documents: {} },
    { ...VALID_PROFILE, links: {} },
    { ...VALID_PROFILE, careerChoice: "not an object" },
    { ...VALID_PROFILE, updatedAt: 123 },
    { ...VALID_PROFILE, unexpected: true },
  ];
  for (const profile of invalidProfiles) {
    await expectApiError(
      () => createValidation({ store, part2: part2() }, request({ profile: profile as unknown as SeekerProfile }), builders),
      "unprocessable",
    );
  }
});

test("rejects malformed nested profile entries", async () => {
  const nullSkill = structuredClone(VALID_PROFILE);
  nullSkill.statedSkills = [null] as unknown as SeekerProfile["statedSkills"];
  await expectApiError(
    () => createValidation({ store: new MemoryGapStore(), part2: part2() }, request({ profile: nullSkill }), builders),
    "unprocessable",
  );

  const unknownDocumentField = structuredClone(VALID_PROFILE);
  unknownDocumentField.documents = [{
    id: "doc_00000000000000000000000000",
    kind: "cv",
    fileName: "cv.pdf",
    uploadedAt: VALID_PROFILE.updatedAt,
    statedSkills: [],
    experience: [],
    education: [],
    unexpected: true,
  } as unknown as SeekerProfile["documents"][number]];
  await expectApiError(
    () => createValidation({ store: new MemoryGapStore(), part2: part2() }, request({ profile: unknownDocumentField }), builders),
    "unprocessable",
  );
});

test("defaults to careerChoice before the first target occupation", async () => {
  const chosen: Occupation = { uri: "http://data.europa.eu/esco/occupation/chosen", label: "chosen occupation", lang: "en" };
  const profile = structuredClone(VALID_PROFILE);
  profile.careerChoice = { occupation: chosen, runId: VALID_RUN.runId, chosenAt: "2026-10-09T00:00:00Z" };
  const validation = await createValidation(
    { store: new MemoryGapStore(), part2: part2({ careerPaths: [{ occupation: chosen, why: [], vacancyCount: 0 }], vacancies: [] }) },
    request({ profile }),
    builders,
  );
  assert.deepEqual(validation.occupation, chosen);
});

test("filters market and trends to the selected occupation", async () => {
  const other: Occupation = { uri: "http://data.europa.eu/esco/occupation/other", label: "other", lang: "en" };
  let marketUris: string[] = [];
  let trendUri: string | undefined;
  const inspectingBuilders: ValidationBuilders = {
    ...builders,
    buildJobProfile: (input) => {
      marketUris = input.market.map((entry) => entry.occupation.uri);
      trendUri = input.trends?.occupation.uri;
      return builders.buildJobProfile(input);
    },
  };
  await createValidation(
    {
      store: new MemoryGapStore(),
      part2: part2({
        market: [...MARKET, { ...MARKET[0]!, occupation: other }],
        trends: [TRENDS, { ...TRENDS, occupation: other }],
      }),
    },
    request(),
    inspectingBuilders,
  );
  assert.deepEqual(marketUris, [OCC.uri]);
  assert.equal(trendUri, OCC.uri);
});

test("gets, lists, and deletes validations with isolated store values", async () => {
  const store = new MemoryGapStore();
  const validation = await createValidation({ store, part2: part2() }, request(), builders);
  assert.deepEqual(await getValidation({ store }, validation.validationId), validation);
  assert.deepEqual(await listValidations({ store }, VALID_PROFILE.seekerId), [validation]);
  assert.deepEqual(await deleteValidations({ store }, VALID_PROFILE.seekerId), { deleted: true, validations: 1 });
  assert.deepEqual(await listValidations({ store }, VALID_PROFILE.seekerId), []);
  await expectApiError(() => getValidation({ store }, validation.validationId), "not_found");
});

test("MemoryGapStore clones writes and reads", async () => {
  const store = new MemoryGapStore();
  const validation = await createValidation({ store, part2: part2() }, request(), builders);
  validation.locations.at(0)!.country = "US";
  const stored = await store.get(validation.validationId);
  assert.equal(stored?.locations.at(0)?.country, "CZ");
  stored!.locations.at(0)!.country = "DE";
  assert.equal((await store.get(validation.validationId))?.locations.at(0)?.country, "CZ");
});
