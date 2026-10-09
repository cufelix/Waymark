import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeekerProfile } from "../contracts.ts";
import { now } from "../core/claims.ts";
import { emptyPreferences } from "../core/profile.ts";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import { MemoryStore } from "../store/memory.ts";
import { warmupFreeText } from "./chat.ts";
import { FAKE_DECK } from "./testdata/deck.ts";
import { WARMUP_QUESTIONS } from "./warmup.ts";

function profile(): SeekerProfile {
  return {
    seekerId: "skr_warmup",
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

test("free-text warm-up maps only allowed options and records stated interview evidence", async () => {
  const store = new MemoryStore();
  await store.create({ profile: profile(), interview: [], draft: {}, cvTexts: {} });
  const llm = new FakeLlm([
    JSON.stringify({
      reply: "Debugging and TypeScript both pull you in. Back to the warm-up.",
      done: false,
      mode: "direct",
      draftPatch: { goal: "learn-fast" },
      statedSkills: [{ label: "TypeScript", quote: "TypeScript" }],
      mappedTo: ["Figuring out why something broke", "Not a real option"],
    }),
  ]);
  const deps = { store, llm, loadDeck: () => FAKE_DECK };

  const result = await warmupFreeText(
    deps,
    "skr_warmup",
    WARMUP_QUESTIONS[0],
    "I lose track of time debugging TypeScript.",
  );
  const record = await store.get("skr_warmup");

  assert.deepEqual(result, {
    reply: "Debugging and TypeScript both pull you in. Back to the warm-up.",
    mappedTo: ["Figuring out why something broke"],
  });
  assert.deepEqual(record?.interview.map(({ role, text }) => ({ role, text })), [
    { role: "seeker", text: "I lose track of time debugging TypeScript." },
    { role: "agent", text: result.reply },
  ]);
  assert.equal(record?.draft.goal, "learn-fast");
  assert.equal(record?.profile.profileVersion, 2);
  assert.equal(record?.profile.statedSkills[0].tier, "stated");
  assert.equal(record?.profile.statedSkills[0].sources[0].url, "seeker-interview://skr_warmup#turn-1");
  assert.equal(record?.profile.statedSkills[0].sources[0].quote, "TypeScript");
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].model, MODELS.interview);
  assert.match(JSON.stringify(llm.calls[0].messages), /Do NOT ask the next warm-up question/);
});
