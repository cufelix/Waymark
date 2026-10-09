import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeLlm, MODELS } from "../llm/llm.ts";
import { mapFreeText } from "./map-answer.ts";
import { WARMUP_QUESTIONS } from "./warmup.ts";

test("free-text mapping uses the fast model and drops unknown and duplicate options", async () => {
  const question = WARMUP_QUESTIONS[1];
  const llm = new FakeLlm([
    JSON.stringify({ mappedTo: ["Building things", "Unknown option", "Building things", "Working with people"] }),
  ]);

  assert.deepEqual(await mapFreeText(llm, question, "I like making things with a team"), ["Building things", "Working with people"]);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].model, MODELS.fast);
  assert.equal(llm.calls[0].json, true);
  assert.equal(llm.calls[0].temperature, 0);
});

test("free-text mapping returns an empty list for empty, malformed, or failed model output", async () => {
  assert.deepEqual(await mapFreeText(new FakeLlm(['{"mappedTo":[]}']), WARMUP_QUESTIONS[0], "nothing fits"), []);
  assert.deepEqual(await mapFreeText(new FakeLlm(["not json"]), WARMUP_QUESTIONS[0], "anything"), []);
  assert.deepEqual(await mapFreeText(new FakeLlm([]), WARMUP_QUESTIONS[0], "anything"), []);
});
