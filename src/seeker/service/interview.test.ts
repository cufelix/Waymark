import test from "node:test";
import assert from "node:assert/strict";
import type { SeekerProfile } from "../contracts.ts";
import { now } from "../core/claims.ts";
import { ApiError } from "../core/errors.ts";
import { emptyPreferences } from "../core/profile.ts";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import { MemoryStore } from "../store/memory.ts";
import { getInterview, interviewTurn } from "./interview.ts";
import { FIRST_INTERVIEW_QUESTION, INTERVIEW_SYSTEM_PROMPT } from "./interview.prompts.ts";

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
  return JSON.stringify({ reply: "Next question?", done: false, mode: "direct", draftPatch: {}, statedSkills: [], ...value });
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

test("skill label unsupported by its verbatim quote is dropped", async () => {
  const { deps, store, llm } = await setup([
    answer({ statedSkills: [{ label: "Rust", quote: "TypeScript" }] }),
    JSON.stringify({ verdicts: [{ index: 0, supported: "no" }] }),
  ]);
  await interviewTurn(deps, "skr_test", "I use TypeScript every day.");

  assert.deepEqual((await store.get("skr_test"))?.profile.statedSkills, []);
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[1].model, MODELS.fast);
});

test("Java label against JavaScript quote goes to semantic verification", async () => {
  const { deps, store, llm } = await setup([
    answer({ statedSkills: [{ label: "Java", quote: "JavaScript" }] }),
    JSON.stringify({ verdicts: [{ index: 0, supported: "yes" }] }),
  ]);
  await interviewTurn(deps, "skr_test", "I use JavaScript every day.");

  assert.deepEqual(
    (await store.get("skr_test"))?.profile.statedSkills.map((claim) => claim.skill?.label),
    ["Java"],
  );
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[1].model, MODELS.fast);
});

test("C programming label against programming quote goes to semantic verification", async () => {
  const { deps, store, llm } = await setup([
    answer({ statedSkills: [{ label: "C programming", quote: "programming" }] }),
    JSON.stringify({ verdicts: [{ index: 0, supported: "yes" }] }),
  ]);
  await interviewTurn(deps, "skr_test", "I enjoy programming.");

  assert.deepEqual(
    (await store.get("skr_test"))?.profile.statedSkills.map((claim) => claim.skill?.label),
    ["C programming"],
  );
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[1].model, MODELS.fast);
});

test("PostgreSQL label is lexically supported as a whole word in a quote", async () => {
  const { deps, store, llm } = await setup([
    answer({ statedSkills: [{ label: "PostgreSQL", quote: "používám PostgreSQL" }] }),
  ]);
  await interviewTurn(deps, "skr_test", "Denně používám PostgreSQL.");

  assert.deepEqual(
    (await store.get("skr_test"))?.profile.statedSkills.map((claim) => claim.skill?.label),
    ["PostgreSQL"],
  );
  assert.equal(llm.calls.length, 1);
});

test("C++ label is lexically supported as a whole word in a quote", async () => {
  const { deps, store, llm } = await setup([
    answer({ statedSkills: [{ label: "C++", quote: "píšu v C++" }] }),
  ]);
  await interviewTurn(deps, "skr_test", "Každý den píšu v C++.");

  assert.deepEqual(
    (await store.get("skr_test"))?.profile.statedSkills.map((claim) => claim.skill?.label),
    ["C++"],
  );
  assert.equal(llm.calls.length, 1);
});

test("one batched fast-model check keeps supported paraphrased skill labels", async () => {
  const { deps, store, llm } = await setup([
    answer({
      statedSkills: [
        { label: "Computer repair", quote: "spravuju počítače" },
        { label: "Hardware upgrades", quote: "vyměnil RAM" },
      ],
    }),
    JSON.stringify({ verdicts: [{ index: 0, supported: "yes" }, { index: 1, supported: "yes" }] }),
  ]);
  await interviewTurn(deps, "skr_test", "Kamarádům spravuju počítače a vyměnil RAM.");

  assert.deepEqual(
    (await store.get("skr_test"))?.profile.statedSkills.map((claim) => claim.skill?.label),
    ["Computer repair", "Hardware upgrades"],
  );
  assert.equal(llm.calls.length, 2, "all non-lexical candidates use one batched verification call");
  assert.equal(llm.calls[1].model, MODELS.fast);
  assert.match(JSON.stringify(llm.calls[1].messages), /Computer repair/);
  assert.match(JSON.stringify(llm.calls[1].messages), /Hardware upgrades/);
});

test("failed semantic skill verification drops unverified skills without failing the turn", async () => {
  const { deps, store, llm } = await setup([
    answer({ statedSkills: [{ label: "Computer repair", quote: "spravuju počítače" }] }),
  ]);

  const result = await interviewTurn(deps, "skr_test", "Kamarádům spravuju počítače.");

  assert.equal(result.reply, "Next question?");
  assert.deepEqual((await store.get("skr_test"))?.profile.statedSkills, []);
  assert.equal(llm.calls.length, 2);
});

test("prompt distinguishes first and repeated practical questions and preserves them in the final summary", () => {
  assert.match(INTERVIEW_SYSTEM_PROMPT, /FIRST practical question/i);
  assert.match(INTERVIEW_SYSTEM_PROMPT, /LATER practical question/i);
  assert.match(INTERVIEW_SYSTEM_PROMPT, /open practical question/i);
  assert.match(INTERVIEW_SYSTEM_PROMPT, /school-leaving exam/i);
});

test("concrete skills from one answer are stored with trimmed verbatim quotes", async () => {
  const { deps, store } = await setup([
    answer({
      statedSkills: [
        { label: "Node.js", quote: " Node.js " },
        { label: "TypeScript", quote: "TypeScript" },
        { label: "PostgreSQL", quote: "PostgreSQL" },
        { label: "Docker", quote: "Docker" },
      ],
    }),
  ]);
  await interviewTurn(deps, "skr_test", "I build APIs with Node.js and TypeScript, backed by PostgreSQL and Docker.");

  const skills = (await store.get("skr_test"))?.profile.statedSkills ?? [];
  assert.deepEqual(skills.map((claim) => claim.skill?.label), ["Node.js", "TypeScript", "PostgreSQL", "Docker"]);
  assert.deepEqual(skills.map((claim) => claim.sources[0].quote), ["Node.js", "TypeScript", "PostgreSQL", "Docker"]);
  assert.ok(skills.every((claim) => claim.tier === "stated" && claim.sources[0].tool === "seeker-interview"));
});

test("unknown confirmed occupation gets a provisional URI and completes the profile", async () => {
  const { deps, store } = await setup([
    answer({ mode: "explore", draftPatch: { targetOccupations: ["HR"] } }),
  ]);
  const result = await interviewTurn(deps, "skr_test", "I choose HR.");
  const record = await store.get("skr_test");

  assert.equal(result.done, false);
  assert.deepEqual(record?.draft.targetOccupations, [{ uri: "urn:stub:occupation:hr", label: "HR", lang: "en" }]);
  assert.deepEqual(record?.profile.preferences.targetOccupations, record?.draft.targetOccupations);
  assert.equal(record?.profile.status, "complete");
});

test("loosely matched taxonomy result does not replace a different occupation", async () => {
  const { deps, store } = await setup([
    answer({ mode: "explore", draftPatch: { targetOccupations: ["software tester"] } }),
  ]);
  await interviewTurn(deps, "skr_test", "I choose software tester.");

  assert.deepEqual((await store.get("skr_test"))?.profile.preferences.targetOccupations, [
    { uri: "urn:stub:occupation:software-tester", label: "software tester", lang: "en" },
  ]);
});

test("provisional occupation preserves the seeker's wording and language", async () => {
  const { deps, store } = await setup([
    answer({
      mode: "explore",
      draftPatch: { targetOccupations: [{ label: "elektrikář", lookup: "electrician", lang: "cs" }] },
    }),
  ]);
  await interviewTurn(deps, "skr_test", "Vybral bych si elektrikáře.");

  assert.deepEqual((await store.get("skr_test"))?.profile.preferences.targetOccupations, [
    { uri: "urn:stub:occupation:electrician", label: "elektrikář", lang: "cs" },
  ]);
});

test("provisional occupation URI is slugified from the English lookup", async () => {
  const { deps, store } = await setup([
    answer({
      mode: "explore",
      draftPatch: {
        targetOccupations: [{ label: "servisní technik počítačů", lookup: "computer service technician", lang: "cs" }],
      },
    }),
  ]);
  await interviewTurn(deps, "skr_test", "Zkusme servisního technika počítačů.");

  assert.deepEqual((await store.get("skr_test"))?.profile.preferences.targetOccupations, [
    {
      uri: "urn:stub:occupation:computer-service-technician",
      label: "servisní technik počítačů",
      lang: "cs",
    },
  ]);
});

test("done waits for a confirmed occupation before the question cap", async () => {
  const { deps } = await setup([
    answer({ mode: "explore", done: true, draftPatch: { locations: [{ country: "CZ", city: "Brno" }] } }),
  ]);

  const result = await interviewTurn(deps, "skr_test", "Zatím si nechci vybrat.");

  assert.equal(result.done, false);
  assert.equal(result.preferences.targetOccupations, undefined);
});

test("direct and explore modes use separate agent-turn caps", async () => {
  const direct = await setup(Array.from({ length: 7 }, () => answer({ mode: "direct" })));
  await interviewTurn(direct.deps, "skr_test", "");
  let directResult;
  for (let i = 0; i < 7; i++) directResult = await interviewTurn(direct.deps, "skr_test", `direct ${i}`);
  assert.equal(directResult?.done, true);

  const explore = await setup(Array.from({ length: 14 }, () => answer({ mode: "explore" })));
  await interviewTurn(explore.deps, "skr_test", "");
  let exploreResult;
  for (let i = 0; i < 14; i++) {
    exploreResult = await interviewTurn(explore.deps, "skr_test", `explore ${i}`);
    if (i === 6) assert.equal(exploreResult.done, false, "explore mode must continue past turn 8");
  }
  assert.equal(exploreResult?.done, true);
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
