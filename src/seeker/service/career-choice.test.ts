import { test } from "node:test";
import assert from "node:assert/strict";
import type { CareerPath, CareerPreferences, Consent } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";
import { validateSeekerProfile } from "../core/validate.ts";
import { FakeResearchClient } from "../research-client.ts";
import { MemoryStore } from "../store/memory.ts";
import { setCareerChoice } from "./career-choice.ts";
import { createSeeker, getProfile, setPreferences } from "./seekers.ts";

const consent: Consent = { dataProcessing: true, nameSearch: false, givenAt: "2026-10-08T21:00:00Z", policyVersion: "fake-policy-v1" };
const preferences = (): CareerPreferences => ({
  targetOccupations: [{ uri: "urn:stub:occupation:fake-cloud-herder", label: "fake cloud herder", lang: "en" }],
  locations: [{ country: "CZ", city: "Testville" }],
  remote: "ok",
  goal: "learn-fast",
  dreamCompanies: [{ name: "Example Moon Base", url: "https://moon-base.example.com" }],
  dealBreakers: ["No fake clouds"],
  languages: [{ lang: "en", level: "fluent" }],
});
const paths = (): CareerPath[] => [
  {
    occupation: { uri: "urn:stub:occupation:fake-cloud-herder", label: "fake cloud herder", lang: "en" },
    why: [],
    vacancyCount: 7,
    ladder: [{ level: "entry", title: "Junior fake cloud herder", claims: [] }],
  },
  {
    occupation: { uri: "urn:stub:occupation:imaginary-moon-cartographer", label: "imaginary moon cartographer", lang: "en" },
    why: [],
    vacancyCount: 3,
  },
];
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;

async function setup() {
  const deps = { store: new MemoryStore(), research: new FakeResearchClient() };
  const seekerId = (await createSeeker(deps, consent)).seekerId;
  await setPreferences(deps, seekerId, preferences());
  return { deps, seekerId };
}

test("sets a career choice, increments the profile version, and leaves preferences unchanged", async () => {
  const { deps, seekerId } = await setup();
  const before = await getProfile(deps, seekerId);
  deps.research.seedRun("run_fake_clouds", seekerId, paths());

  const choice = await setCareerChoice(deps, seekerId, {
    runId: "run_fake_clouds",
    occupationUri: "urn:stub:occupation:fake-cloud-herder",
  });

  assert.deepEqual(choice.occupation, paths()[0].occupation);
  assert.equal(choice.runId, "run_fake_clouds");
  assert.match(choice.chosenAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const after = await getProfile(deps, seekerId);
  assert.equal(after.profileVersion, before.profileVersion + 1);
  assert.deepEqual(after.preferences, before.preferences);
  assert.deepEqual(after.careerChoice, choice);
  assert.deepEqual(validateSeekerProfile(after), after);
});

test("calling setCareerChoice again replaces the existing choice", async () => {
  const { deps, seekerId } = await setup();
  deps.research.seedRun("run_fake_clouds", seekerId, paths());
  await setCareerChoice(deps, seekerId, { runId: "run_fake_clouds", occupationUri: paths()[0].occupation.uri });
  const before = await getProfile(deps, seekerId);

  const replacement = await setCareerChoice(deps, seekerId, {
    runId: "run_fake_clouds",
    occupationUri: paths()[1].occupation.uri,
  });

  const after = await getProfile(deps, seekerId);
  assert.deepEqual(replacement.occupation, paths()[1].occupation);
  assert.deepEqual(after.careerChoice, replacement);
  assert.equal(after.profileVersion, before.profileVersion + 1);
});

test("rejects an occupation that was not among the run's career paths", async () => {
  const { deps, seekerId } = await setup();
  deps.research.seedRun("run_fake_clouds", seekerId, paths());
  await assert.rejects(
    setCareerChoice(deps, seekerId, { runId: "run_fake_clouds", occupationUri: "urn:stub:occupation:invented-wizard" }),
    code("unprocessable"),
  );
});

test("rejects another seeker's run and an unknown run", async () => {
  const { deps, seekerId } = await setup();
  const otherSeekerId = (await createSeeker(deps, consent)).seekerId;
  deps.research.seedRun("run_fake_foreign", otherSeekerId, paths());
  await assert.rejects(
    setCareerChoice(deps, seekerId, { runId: "run_fake_foreign", occupationUri: paths()[0].occupation.uri }),
    code("unprocessable"),
  );
  await assert.rejects(
    setCareerChoice(deps, seekerId, { runId: "run_fake_missing", occupationUri: paths()[0].occupation.uri }),
    code("unprocessable"),
  );
});

test("unknown and deletion-pending seekers are not_found before Part 2 is queried", async () => {
  const { deps, seekerId } = await setup();
  deps.research.failRunGets = true;
  await assert.rejects(
    setCareerChoice(deps, "skr_01M4EPBGAC0000000000000000", { runId: "run_fake_clouds", occupationUri: paths()[0].occupation.uri }),
    code("not_found"),
  );
  await deps.store.update(seekerId, (record) => ({ ...record, deletionPending: true }));
  await assert.rejects(
    setCareerChoice(deps, seekerId, { runId: "run_fake_clouds", occupationUri: paths()[0].occupation.uri }),
    code("not_found"),
  );
});
