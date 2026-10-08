import test from "node:test";
import assert from "node:assert/strict";
import type { SeekerProfile } from "../contracts.ts";
import { now } from "../core/claims.ts";
import { ApiError } from "../core/errors.ts";
import { emptyPreferences } from "../core/profile.ts";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import { MemoryStore } from "../store/memory.ts";
import { getInterview, interviewTurn } from "./interview.ts";
import { FIRST_INTERVIEW_QUESTION } from "./interview.prompts.ts";

function profile(seekerId = "skr_test"): SeekerProfile {
  return {
    seekerId,
    profileVersion: 1,
    status: "incomplete",
    consent: { dataProcessing: true, nameSearch: false, givenAt: now(), policyVersion: "1" },
    preferences: emptyPreferences(),
    statedSkills: [],
    documents: [],
    links: [],
    updatedAt: now(),
  };
}

async function setup(answers: string[] = [], options: { deletionPending?: boolean } = {}) {
  const store = new MemoryStore();
  await store.create({ profile: profile(), interview: [], draft: {}, cvTexts: {}, ...options });
  const llm = new FakeLlm(answers);
  return { store, llm, deps: { store, llm } };
}

function answer(value: Record<string, unknown>): string {
  return JSON.stringify({ reply: "Next question?", done: false, draftPatch: {}, statedSkills: [], ...value });
}

test("empty first turn asks and stores the fixed first question without an LLM call", async () => {
  const { deps, llm } = await setup();
  const result = await interviewTurn(deps, "skr_test", "");

  assert.deepEqual(result, { reply: FIRST_INTERVIEW_QUESTION, done: false, preferences: {} });
  assert.equal(llm.calls.length, 0);
  assert.deepEqual((await getInterview(deps, "skr_test")).map(({ role, text }) => ({ role, text })), [
    { role: "agent", text: FIRST_INTERVIEW_QUESTION },
  ]);
});

test("empty text after the interview starts repeats the last agent turn", async () => {
  const { deps, llm } = await setup();
  await interviewTurn(deps, "skr_test", "");
  const repeated = await interviewTurn(deps, "skr_test", "");

  assert.equal(repeated.reply, FIRST_INTERVIEW_QUESTION);
  assert.equal(llm.calls.length, 0);
  assert.equal((await getInterview(deps, "skr_test")).length, 1);
});

test("normal turn maps occupations, validates fields, and appends both turns", async () => {
  const { deps, store, llm } = await setup([
    answer({
      reply: "Do you prefer remote work?",
      draftPatch: { targetOccupations: ["backend developer"], locations: [{ country: "cz", city: "Prague" }] },
    }),
  ]);
  await interviewTurn(deps, "skr_test", "I want to work as a backend developer in Prague.");

  const record = await store.get("skr_test");
  assert.equal(record?.draft.targetOccupations?.[0].uri, "urn:stub:occupation:backend-developer");
  assert.deepEqual(record?.draft.locations, [{ country: "CZ", city: "Prague" }]);
  assert.deepEqual(record?.interview.map((turn) => turn.role), ["seeker", "agent"]);
  assert.equal(llm.calls[0].model, MODELS.interview);
  assert.equal(llm.calls[0].json, true);
});

test("invented skill quote is dropped", async () => {
  const { deps, store } = await setup([
    answer({ statedSkills: [{ label: "Rust", quote: "Rust" }] }),
  ]);
  await interviewTurn(deps, "skr_test", "I use TypeScript every day.");

  assert.deepEqual((await store.get("skr_test"))?.profile.statedSkills, []);
});

test("garbage JSON is retried once and then becomes upstream_failed", async () => {
  const { deps, llm, store } = await setup(["not json", "still not json"]);

  await assert.rejects(
    interviewTurn(deps, "skr_test", "hello"),
    (error: unknown) => error instanceof ApiError && error.code === "upstream_failed",
  );
  assert.equal(llm.calls.length, 2);
  assert.equal((await store.get("skr_test"))?.interview.length, 0);
});

test("invalid enum and malformed country are dropped without losing valid fields", async () => {
  const { deps, store } = await setup([
    answer({ draftPatch: { remote: "sometimes", goal: "money", locations: [{ country: "USA" }], dealBreakers: ["On-call"] } }),
  ]);
  const result = await interviewTurn(deps, "skr_test", "No on-call work.");

  assert.deepEqual(result.preferences, { dealBreakers: ["On-call"] });
  assert.equal((await store.get("skr_test"))?.draft.remote, undefined);
});

test("done copies complete preferences and bumps profile version and status", async () => {
  const { deps, store } = await setup([
    answer({
      reply: "Thanks, that is everything.",
      done: true,
      draftPatch: {
        targetOccupations: ["nurse"],
        locations: [{ country: "CZ" }],
        remote: "no",
        goal: "mission",
        dreamCompanies: [{ name: "Example Hospital" }],
        dealBreakers: [],
        languages: [{ lang: "cs", level: "native" }],
        salaryExpectation: { min: 60000, currency: "CZK", period: "month" },
      },
      statedSkills: [{ label: "patient care", quote: "patient care" }],
    }),
  ]);
  const result = await interviewTurn(deps, "skr_test", "I am a nurse with patient care experience.");
  const record = await store.get("skr_test");

  assert.equal(result.done, true);
  assert.equal(record?.profile.preferences.targetOccupations[0].label, "nurse");
  assert.equal(record?.profile.status, "complete");
  assert.equal(record?.profile.profileVersion, 2);
  assert.equal(record?.profile.statedSkills[0].tier, "stated");
  assert.equal(record?.profile.statedSkills[0].sources[0].url, "seeker-interview://skr_test#turn-1");
  assert.equal(record?.profile.statedSkills[0].sources[0].quote, "patient care");
});

test("unknown and deletion-pending seekers are not found", async () => {
  const { deps } = await setup();
  await assert.rejects(getInterview(deps, "skr_missing"), (error: unknown) => error instanceof ApiError && error.code === "not_found");

  const pending = await setup([], { deletionPending: true });
  await assert.rejects(
    interviewTurn(pending.deps, "skr_test", "hello"),
    (error: unknown) => error instanceof ApiError && error.code === "not_found",
  );
  assert.equal(pending.llm.calls.length, 0);
});
