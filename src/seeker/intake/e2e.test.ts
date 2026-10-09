import assert from "node:assert/strict";
import { test } from "node:test";
import { handle, type ApiDeps, type ApiRequest, type ApiResponse } from "../api.ts";
import type { Intake, SeekerProfile } from "../contracts.ts";
import { FakeLlm } from "../llm/llm.ts";
import { FakeResearchClient } from "../research-client.ts";
import { MemoryStore } from "../store/memory.ts";
import { FAKE_DECK } from "./testdata/deck.ts";

const KEY = "guided-intake-test-key";
const headers = { authorization: `Bearer ${KEY}` };
const forbiddenKey = /score|fit|match|percent|probability/i;

function scanPublicKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(scanPublicKeys);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, forbiddenKey, `forbidden public key: ${key}`);
    scanPublicKeys(child);
  }
}

test("guided intake completes end to end through handle", async () => {
  const deps: ApiDeps = {
    store: new MemoryStore(),
    llm: new FakeLlm([JSON.stringify({
      reply: "That sounds investigative.",
      done: false,
      mode: "direct",
      draftPatch: {},
      statedSkills: [],
      mappedTo: ["Figuring out why something broke"],
    })]),
    research: new FakeResearchClient(),
    intake: { loadDeck: () => FAKE_DECK },
    apiKeys: [KEY],
  };
  const call = async (method: string, path: string, body?: unknown): Promise<ApiResponse> => {
    const request: ApiRequest = { method, path, headers, ...(body === undefined ? {} : { body }) };
    const response = await handle(request, deps);
    if (response.body.ok) scanPublicKeys(response.body.data);
    return response;
  };

  const created = await call("POST", "/v1/seekers", {
    consent: {
      dataProcessing: true,
      nameSearch: false,
      givenAt: "2026-10-09T12:00:00Z",
      policyVersion: "2026-10-01",
    },
  });
  assert.equal(created.status, 201);
  const seekerId = (created.body.data as { seekerId: string }).seekerId;

  const initial = await call("GET", `/v1/seekers/${seekerId}/intake`);
  assert.equal(initial.status, 200);
  assert.equal((initial.body.data as Intake).phase, "warmup");

  const freeText = await call("POST", `/v1/seekers/${seekerId}/intake/warmup`, {
    questionKey: "drawn",
    answer: "I lose track of time debugging strange failures.",
  });
  assert.equal(freeText.status, 200);
  assert.equal((freeText.body.data as Intake).warmup.answers[0]?.reply, "That sounds investigative.");
  await call("POST", `/v1/seekers/${seekerId}/intake/warmup`, {
    questionKey: "with",
    answer: "Building things",
  });
  let intake = (await call("POST", `/v1/seekers/${seekerId}/intake/warmup`, {
    questionKey: "goal",
    answer: "A stable job and salary",
  })).body.data as Intake;

  let ratings = 0;
  while (!intake.cards.done) {
    assert.ok(intake.cards.current);
    const rated = await call(
      "POST",
      `/v1/seekers/${seekerId}/intake/cards/${intake.cards.current.cardId}/rating`,
      { rating: "like" },
    );
    assert.equal(rated.status, 200);
    intake = rated.body.data as Intake;
    ratings++;
    assert.ok(ratings <= 12);
  }
  const topThree = intake.paths.filter((path) => path.top3).slice(0, 3).map((path) => path.occupation);

  const practical = await call("PUT", `/v1/seekers/${seekerId}/intake/practical`, {
    locations: [{ country: "CZ", city: "Prague" }],
    remote: "ok",
    hoursPerWeek: "10-20",
    courseBudget: "some",
    education: "bachelor",
    languages: [{ lang: "cs", level: "native" }, { lang: "en", level: "working" }],
    dreamCompanies: [{ name: "Example Labs", url: "https://example.com" }],
  });
  assert.equal(practical.status, 200);
  assert.equal((practical.body.data as Intake).phase, "chat");

  const profileResponse = await call("GET", `/v1/seekers/${seekerId}/profile`);
  const profile = profileResponse.body.data as SeekerProfile;
  assert.equal(profile.status, "complete");
  assert.deepEqual(profile.preferences.targetOccupations, topThree);

  const skipped = await call("POST", `/v1/seekers/${seekerId}/intake/chat/skip`);
  assert.equal(skipped.status, 200);
  assert.equal((skipped.body.data as Intake).phase, "done");
  const final = await call("GET", `/v1/seekers/${seekerId}/intake`);
  assert.equal((final.body.data as Intake).phase, "done");
});
