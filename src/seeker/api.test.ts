import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, type ApiDeps, type ApiRequest } from "./api.ts";
import type { Intake } from "./contracts.ts";
import type { Deck } from "./intake/deck.ts";
import type { IntakeState } from "./intake/engine.ts";
import type { IntakeEngine } from "./intake/service.ts";
import { FAKE_DECK } from "./intake/testdata/deck.ts";
import { WARMUP_QUESTIONS } from "./intake/warmup.ts";
import { FakeLlm } from "./llm/llm.ts";
import { FakeResearchClient } from "./research-client.ts";
import { FakeExa } from "./salary/exa.ts";
import { MemoryStore } from "./store/memory.ts";

const KEY = "test-key-not-a-secret";
const auth = { authorization: `Bearer ${KEY}` };
const consent = { dataProcessing: true, nameSearch: false, givenAt: "2026-10-08T21:00:00Z", policyVersion: "2026-10-01" };
const prefs = {
  targetOccupations: [{ uri: "urn:stub:occupation:backend-developer", label: "backend developer", lang: "en" }],
  locations: [{ country: "CZ", city: "Prague" }],
  remote: "ok",
  goal: "learn-fast",
  dreamCompanies: [],
  dealBreakers: [],
  languages: [{ lang: "en", level: "working" }],
};

const practical = {
  locations: [{ country: "CZ", city: "Prague" }],
  remote: "ok",
  hoursPerWeek: "5-10",
  courseBudget: "some",
  education: "bachelor",
  languages: [{ lang: "cs", level: "native" }],
  dreamCompanies: [],
};

function intakePublic(state: IntakeState): Intake {
  const { seekerId, phase, warmup, cards, paths, practical: saved, deck } = state;
  return { seekerId, phase, warmup, cards, paths, ...(saved ? { practical: saved } : {}), deck };
}

const intakeEngine: IntakeEngine = {
  newIntakeState(seekerId: string, deck: Deck): IntakeState {
    return {
      seekerId,
      phase: "warmup",
      warmup: { questions: structuredClone(WARMUP_QUESTIONS), answers: [], currentKey: "drawn" },
      cards: { rated: [], done: false },
      paths: deck.paths.map(({ occupation }, index) => ({ occupation, liked: 0, maybe: 0, notForMe: 0, top3: index < 3 })),
      deck: { country: deck.country, version: deck.version },
      scores: {},
      shownCounts: {},
      extraUntil: 0,
    };
  },
  applyWarmup(state, deck, key, mappedTo, answer): IntakeState {
    const index = state.warmup.questions.findIndex((question) => question.key === key);
    const nextQuestion = state.warmup.questions[index + 1];
    return {
      ...state,
      phase: nextQuestion ? "warmup" : "cards",
      warmup: {
        ...state.warmup,
        answers: [...state.warmup.answers, { key, answer, mappedTo }],
        currentKey: nextQuestion?.key,
      },
      cards: nextQuestion ? state.cards : { ...state.cards, current: deck.cards[0] },
    };
  },
  applyRating(state, deck, cardId, rating, at): IntakeState {
    const card = deck.cards.find((candidate) => candidate.cardId === cardId)!;
    return { ...state, phase: "practical", cards: { rated: [...state.cards.rated, { card, rating, at }], done: true } };
  },
  addMoreCards(state, deck): IntakeState {
    return { ...state, phase: "cards", cards: { ...state.cards, done: false, current: deck.cards[1] }, extraUntil: state.cards.rated.length + 4 };
  },
  toPublic: (state) => intakePublic(state),
};

function setup() {
  const research = new FakeResearchClient();
  const deps: ApiDeps = {
    store: new MemoryStore(),
    llm: new FakeLlm([]),
    research,
    intake: { loadDeck: () => FAKE_DECK, engine: intakeEngine },
    apiKeys: [KEY],
  };
  const call = (method: string, path: string, body?: unknown, headers: ApiRequest["headers"] = auth, file?: ApiRequest["file"]) =>
    handle({ method, path, headers, body, ...(file ? { file } : {}) }, deps);
  const create = async () => {
    const r = await call("POST", "/v1/seekers", { consent });
    assert.equal(r.status, 201);
    return (r.body.data as { seekerId: string }).seekerId;
  };
  return { deps, research, call, create };
}

const errCode = (r: { body: { error: { code: string } | null } }) => r.body.error?.code;

test("envelope shape on success and error, with a requestId", async () => {
  const { call } = setup();
  const okRes = await call("POST", "/v1/seekers", { consent });
  assert.equal(okRes.body.ok, true);
  assert.equal(okRes.body.error, null);
  assert.match(okRes.body.meta.requestId, /^req_/);
  const bad = await call("GET", "/v1/seekers/skr_01M4EPBGAC0000000000000000/profile");
  assert.deepEqual(Object.keys(bad.body).sort(), ["data", "error", "meta", "ok"]);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.data, null);
});

test("no auth or a wrong key is 401 on every route, before routing", async () => {
  const { call } = setup();
  for (const [m, p] of [
    ["POST", "/v1/seekers"],
    ["GET", "/v1/seekers/skr_01M4EPBGAC0000000000000000/profile"],
    ["POST", "/v1/seekers/skr_01M4EPBGAC0000000000000000/interview/messages"],
    ["GET", "/v1/seekers/skr_01M4EPBGAC0000000000000000/interview"],
    ["POST", "/v1/seekers/skr_01M4EPBGAC0000000000000000/documents"],
    ["DELETE", "/v1/seekers/skr_01M4EPBGAC0000000000000000/documents/doc_01M4EPBGAC0000000000000000"],
    ["GET", "/nope"],
  ]) {
    const none = await call(m, p, { consent }, {});
    assert.equal(none.status, 401);
    assert.equal(errCode(none), "unauthorized");
    assert.equal((await call(m, p, { consent }, { authorization: "Bearer wrong" })).status, 401);
  }
});

test("interview message and transcript routes validate input and round-trip the first turn", async () => {
  const { call, create } = setup();
  const id = await create();

  const first = await call("POST", `/v1/seekers/${id}/interview/messages`, { text: "" });
  assert.equal(first.status, 200);
  assert.equal((first.body.data as any).done, false);
  assert.match((first.body.data as any).reply, /career advisor/);

  const transcript = await call("GET", `/v1/seekers/${id}/interview`);
  assert.equal(transcript.status, 200);
  assert.deepEqual((transcript.body.data as any[]).map(({ role }) => role), ["agent"]);

  for (const invalid of [{ text: "hi", extra: true }, { text: 42 }, { text: "x".repeat(4001) }]) {
    const response = await call("POST", `/v1/seekers/${id}/interview/messages`, invalid);
    assert.equal(response.status, 422);
    assert.equal(errCode(response), "unprocessable");
  }
});

test("guided intake routes cover warm-up, ratings, more cards, practical data, skip, export and delete", async () => {
  const { call, create, deps } = setup();
  const id = await create();
  const unknownId = "skr_01M4EPBGAC0000000000000000";

  assert.equal((await call("GET", `/v1/seekers/${unknownId}/intake`)).status, 404);
  const initial = await call("GET", `/v1/seekers/${id}/intake`);
  assert.equal(initial.status, 200);
  assert.equal((initial.body.data as any).warmup.currentKey, "drawn");

  const invalidWarmup = await call("POST", `/v1/seekers/${id}/intake/warmup`, { questionKey: "drawn", answer: "", extra: true });
  assert.equal(invalidWarmup.status, 422);
  assert.equal(errCode(invalidWarmup), "unprocessable");
  const wrongWarmup = await call("POST", `/v1/seekers/${id}/intake/warmup`, { questionKey: "with", answer: "Building things" });
  assert.equal(wrongWarmup.status, 409);
  assert.equal(errCode(wrongWarmup), "conflict");

  for (const body of [
    { questionKey: "drawn", answer: "Organising chaos" },
    { questionKey: "with", answer: "Building things" },
    { questionKey: "goal", answer: "A stable job and salary" },
  ]) {
    assert.equal((await call("POST", `/v1/seekers/${id}/intake/warmup`, body)).status, 200);
  }
  let intake = (await call("GET", `/v1/seekers/${id}/intake`)).body.data as any;
  const firstCardId = intake.cards.current.cardId as string;

  assert.equal((await call("POST", `/v1/seekers/${id}/intake/cards/more`)).status, 409);
  assert.equal((await call("POST", `/v1/seekers/${id}/intake/cards/more`, { extra: true })).status, 422);
  assert.equal((await call("POST", `/v1/seekers/${id}/intake/cards/${firstCardId}/rating`, { rating: "love" })).status, 422);
  assert.equal(
    (await call("POST", `/v1/seekers/${id}/intake/cards/${FAKE_DECK.cards[1].cardId}/rating`, { rating: "like" })).status,
    409,
  );
  assert.equal(
    (await call("POST", `/v1/seekers/${id}/intake/cards/crd_00000000000000000000000099/rating`, { rating: "like" })).status,
    404,
  );
  const rated = await call("POST", `/v1/seekers/${id}/intake/cards/${firstCardId}/rating`, { rating: "maybe" });
  assert.equal(rated.status, 200);
  assert.equal((rated.body.data as any).cards.done, true);

  const more = await call("POST", `/v1/seekers/${id}/intake/cards/more`);
  assert.equal(more.status, 200);
  const secondCardId = (more.body.data as any).cards.current.cardId as string;
  assert.equal((await call("POST", `/v1/seekers/${id}/intake/cards/${secondCardId}/rating`, { rating: "like" })).status, 200);

  assert.equal((await call("POST", `/v1/seekers/${id}/intake/chat/skip`)).status, 409);
  assert.equal((await call("PUT", `/v1/seekers/${id}/intake/practical`, { ...practical, languages: [] })).status, 422);
  const { dreamCompanies: _omitted, ...missingDreamCompanies } = practical;
  assert.equal((await call("PUT", `/v1/seekers/${id}/intake/practical`, missingDreamCompanies)).status, 422);
  assert.equal((await call("PUT", `/v1/seekers/${unknownId}/intake/practical`, practical)).status, 404);
  const saved = await call("PUT", `/v1/seekers/${id}/intake/practical`, practical);
  assert.equal(saved.status, 200);
  assert.equal((saved.body.data as any).phase, "chat");

  const profile = (await call("GET", `/v1/seekers/${id}/profile`)).body.data as any;
  assert.equal(profile.status, "complete");
  assert.equal(profile.preferences.targetOccupations.length, 3);
  assert.deepEqual(profile.preferences.languages, practical.languages);
  assert.deepEqual(profile.preferences.dreamCompanies, []);

  const exported = await call("GET", `/v1/seekers/${id}/export`);
  assert.equal(exported.status, 200);
  assert.equal((exported.body.data as any).intake.phase, "chat");
  assert.equal("scores" in (exported.body.data as any).intake, false);
  assert.equal("shownCounts" in (exported.body.data as any).intake, false);

  assert.equal((await call("POST", `/v1/seekers/${id}/intake/chat/skip`, { extra: true })).status, 422);
  const skipped = await call("POST", `/v1/seekers/${id}/intake/chat/skip`);
  assert.equal(skipped.status, 200);
  assert.equal((skipped.body.data as any).phase, "done");

  assert.equal((await call("DELETE", `/v1/seekers/${id}`)).status, 200);
  assert.equal(await deps.store.getIntake(id), undefined);
});

test("a done interview response ends an intake in the chat phase", async () => {
  const { call, create, deps } = setup();
  const id = await create();
  await call("GET", `/v1/seekers/${id}/intake`);
  await call("POST", `/v1/seekers/${id}/intake/warmup`, { questionKey: "drawn", answer: "Organising chaos" });
  await call("POST", `/v1/seekers/${id}/intake/warmup`, { questionKey: "with", answer: "Working with people" });
  const cards = await call("POST", `/v1/seekers/${id}/intake/warmup`, { questionKey: "goal", answer: "Learn fast and grow" });
  const cardId = (cards.body.data as any).cards.current.cardId;
  await call("POST", `/v1/seekers/${id}/intake/cards/${cardId}/rating`, { rating: "like" });
  await call("PUT", `/v1/seekers/${id}/intake/practical`, practical);
  deps.llm = new FakeLlm([
    JSON.stringify({ reply: "That is everything I need.", done: true, mode: "direct", draftPatch: {}, statedSkills: [] }),
  ]);

  const response = await call("POST", `/v1/seekers/${id}/interview/messages`, { text: "Nothing else." });
  assert.equal(response.status, 200);
  assert.equal((response.body.data as any).done, true);
  assert.equal(((await call("GET", `/v1/seekers/${id}/intake`)).body.data as any).phase, "done");
});

test("document upload and delete routes accept the file field and remove the document", async () => {
  const { call, create, deps } = setup();
  const id = await create();
  deps.llm = new FakeLlm([JSON.stringify({ skills: [], experience: [], education: [] })]);

  const missing = await call("POST", `/v1/seekers/${id}/documents`);
  assert.equal(missing.status, 422);
  assert.equal(errCode(missing), "unprocessable");

  const uploaded = await call(
    "POST",
    `/v1/seekers/${id}/documents`,
    undefined,
    auth,
    { fileName: "cv.txt", mimeType: "text/plain", bytes: Buffer.from("Jane Example\nBuilt APIs with TypeScript") },
  );
  assert.equal(uploaded.status, 201);
  assert.equal((uploaded.body.data as any).kind, "cv");
  const documentId = (uploaded.body.data as any).id as string;
  assert.match(documentId, /^doc_/);

  const deleted = await call("DELETE", `/v1/seekers/${id}/documents/${documentId}`);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.data, { deleted: true });
  assert.deepEqual(((await call("GET", `/v1/seekers/${id}/profile`)).body.data as any).documents, []);
});

test("document upload stores an explicit kind and rejects an invalid kind", async () => {
  const { call, create, deps } = setup();
  const id = await create();

  const invalid = await call(
    "POST",
    `/v1/seekers/${id}/documents`,
    undefined,
    auth,
    { fileName: "work.txt", mimeType: "text/plain", bytes: Buffer.from("Built APIs with TypeScript"), kind: "transcript" },
  );
  assert.equal(invalid.status, 422);
  assert.equal(errCode(invalid), "unprocessable");

  deps.llm = new FakeLlm([JSON.stringify({ skills: [], experience: [], education: [] })]);
  const uploaded = await call(
    "POST",
    `/v1/seekers/${id}/documents`,
    undefined,
    auth,
    { fileName: "work.txt", mimeType: "text/plain", bytes: Buffer.from("Built APIs with TypeScript"), kind: "portfolio" },
  );
  assert.equal(uploaded.status, 201);
  assert.equal((uploaded.body.data as any).kind, "portfolio");
  assert.equal(((await call("GET", `/v1/seekers/${id}/profile`)).body.data as any).documents[0].kind, "portfolio");
});

test("missing consent is 403, unknown field is 422", async () => {
  const { call } = setup();
  const missing = await call("POST", "/v1/seekers", {});
  assert.equal(missing.status, 403);
  assert.equal(errCode(missing), "consent_required");
  assert.equal((await call("POST", "/v1/seekers", { consent: { ...consent, dataProcessing: false } })).status, 403);
  const unknown = await call("POST", "/v1/seekers", { consent, role: "admin" });
  assert.equal(unknown.status, 422);
  assert.equal(errCode(unknown), "unprocessable");
  assert.match(unknown.body.error!.message, /role: unknown field/);
});

test("profile becomes complete after valid preferences; links round-trip", async () => {
  const { call, create } = setup();
  const id = await create();
  assert.equal(((await call("GET", `/v1/seekers/${id}/profile`)).body.data as any).status, "incomplete");
  const put = await call("PUT", `/v1/seekers/${id}/preferences`, prefs);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.data, prefs);
  const links = await call("PUT", `/v1/seekers/${id}/links`, { links: [{ url: "https://github.example.com/x", kind: "github" }] });
  assert.equal(links.status, 200);
  assert.match((links.body.data as any)[0].id, /^lnk_/);
  const profile = (await call("GET", `/v1/seekers/${id}/profile?x=1`)).body.data as any;
  assert.equal(profile.status, "complete");
  assert.equal(profile.profileVersion, 3);
  assert.equal(profile.links.length, 1);
  const untyped = await call("PUT", `/v1/seekers/${id}/links`, { links: [{ url: "https://unknown.example.com/x" }] });
  assert.equal(untyped.status, 200);
  assert.equal("kind" in (untyped.body.data as any)[0], false);
  assert.equal((await call("PUT", `/v1/seekers/${id}/preferences`, { ...prefs, score: 90 })).status, 422);
  assert.equal((await call("PUT", `/v1/seekers/${id}/preferences`, { ...prefs, targetOccupations: [] })).status, 422);
});

test("export includes Part 2's research runs", async () => {
  const { call, create, research } = setup();
  const id = await create();
  research.runs.set(id, [{ runId: "run_01", seekerId: id, status: "done" }]);
  const ex = await call("GET", `/v1/seekers/${id}/export`);
  assert.equal(ex.status, 200);
  assert.deepEqual((ex.body.data as any).researchRuns, [{ runId: "run_01", seekerId: id, status: "done" }]);
  assert.equal((ex.body.data as any).profile.seekerId, id);
  research.failLists = true;
  assert.equal((await call("GET", `/v1/seekers/${id}/export`)).status, 502);
});

test("salary sources returned by the message route remain in the export", async () => {
  const { call, create, deps } = setup();
  const id = await create();
  const page = { title: "Fake salary", url: "https://salary.example/api", text: "Pay is 35000 CZK per month." };
  deps.exa = new FakeExa([page]);
  deps.llm = new FakeLlm([
    JSON.stringify({
      reply: "The overview will cover pay.",
      done: false,
      mode: "direct",
      draftPatch: {},
      statedSkills: [],
      salaryLookup: { lookup: "technician", country: "CZ" },
    }),
    JSON.stringify({ figures: [{ median: 35000, currency: "CZK", period: "month", url: page.url, quote: page.text }] }),
    JSON.stringify({ reply: "A quick web lookup reports [35000 CZK per month](https://salary.example/api). Which city?" }),
  ]);

  const message = await call("POST", `/v1/seekers/${id}/interview/messages`, { text: "What does a technician earn?" });
  assert.equal(message.status, 200);
  assert.equal((message.body.data as any).sources[0].tool, "exa");

  const exported = await call("GET", `/v1/seekers/${id}/export`);
  const source = (exported.body.data as any).interview.at(-1).sources[0];
  assert.equal(source.url, page.url);
  assert.equal(source.quote, page.text);
});

test("career choice is authenticated, validated, and appears in profile and export", async () => {
  const { call, create, research } = setup();
  const id = await create();
  const occupation = { uri: "urn:stub:occupation:fake-starlight-engineer", label: "fake starlight engineer", lang: "en" };
  research.seedRun("run_fake_starlight", id, [{ occupation, why: [], vacancyCount: 4 }]);

  const noAuth = await call(
    "PUT",
    `/v1/seekers/${id}/career-choice`,
    { runId: "run_fake_starlight", occupationUri: occupation.uri },
    {},
  );
  assert.equal(noAuth.status, 401);
  const unknown = await call("PUT", `/v1/seekers/${id}/career-choice`, {
    runId: "run_fake_starlight",
    occupationUri: occupation.uri,
    score: 99,
  });
  assert.equal(unknown.status, 422);
  assert.match(unknown.body.error!.message, /score: unknown field/);

  const put = await call("PUT", `/v1/seekers/${id}/career-choice`, {
    runId: "run_fake_starlight",
    occupationUri: occupation.uri,
  });
  assert.equal(put.status, 200);
  assert.deepEqual((put.body.data as any).occupation, occupation);
  const profile = (await call("GET", `/v1/seekers/${id}/profile`)).body.data as any;
  assert.deepEqual(profile.careerChoice, put.body.data);
  const exported = (await call("GET", `/v1/seekers/${id}/export`)).body.data as any;
  assert.deepEqual(exported.profile.careerChoice, put.body.data);
});

test("career choice returns sanitized 502 when Part 2 fails", async () => {
  const { call, create, research } = setup();
  const id = await create();
  research.failRunGets = true;
  const response = await call("PUT", `/v1/seekers/${id}/career-choice`, {
    runId: "run_fake_upstream_secret",
    occupationUri: "urn:stub:occupation:fake-secret-reader",
  });
  assert.equal(response.status, 502);
  assert.equal(errCode(response), "upstream_failed");
  assert.doesNotMatch(JSON.stringify(response.body), /password|api.?key|upstream response body/i);

  research.failRunGets = false;
  research.seedRun("run_fake_paths_failure", id);
  research.failCareerPathGets = true;
  const pathsFailure = await call("PUT", `/v1/seekers/${id}/career-choice`, {
    runId: "run_fake_paths_failure",
    occupationUri: "urn:stub:occupation:fake-secret-reader",
  });
  assert.equal(pathsFailure.status, 502);
  assert.equal(errCode(pathsFailure), "upstream_failed");
  assert.doesNotMatch(JSON.stringify(pathsFailure.body), /password|api.?key|upstream response body/i);
});

test("delete with failing Part 2 is 502, seeker is gone for reads, retry succeeds", async () => {
  const { call, create, research, deps } = setup();
  const id = await create();
  research.failDeletes = 1;
  const first = await call("DELETE", `/v1/seekers/${id}`);
  assert.equal(first.status, 502);
  assert.equal(errCode(first), "upstream_failed");
  assert.equal((await call("GET", `/v1/seekers/${id}/profile`)).status, 404);
  assert.equal((await call("PUT", `/v1/seekers/${id}/links`, { links: [] })).status, 404);
  assert.equal((await call("GET", `/v1/seekers/${id}/export`)).status, 200);
  const retry = await call("DELETE", `/v1/seekers/${id}`);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.data, { deleted: true });
  assert.equal(await deps.store.get(id), null);
  assert.deepEqual(research.deleted, [id]);
  assert.equal((await call("DELETE", `/v1/seekers/${id}`)).status, 404);
  assert.equal((await call("GET", `/v1/seekers/${id}/export`)).status, 404);
});

test("seeker A's id never returns seeker B's data", async () => {
  const { call, create, research } = setup();
  const a = await create();
  const b = await create();
  await call("PUT", `/v1/seekers/${a}/preferences`, prefs);
  await call("PUT", `/v1/seekers/${a}/links`, { links: [{ url: "https://a.example.com", kind: "portfolio" }] });
  research.runs.set(a, [{ runId: "run_A" }]);
  research.runs.set(b, [{ runId: "run_B" }]);
  const pa = (await call("GET", `/v1/seekers/${a}/profile`)).body.data as any;
  const pb = (await call("GET", `/v1/seekers/${b}/profile`)).body.data as any;
  assert.equal(pa.seekerId, a);
  assert.equal(pb.seekerId, b);
  assert.equal(pb.status, "incomplete");
  assert.deepEqual(pb.links, []);
  assert.deepEqual(((await call("GET", `/v1/seekers/${b}/export`)).body.data as any).researchRuns, [{ runId: "run_B" }]);
  await call("DELETE", `/v1/seekers/${a}`);
  assert.equal((await call("GET", `/v1/seekers/${b}/profile`)).status, 200);
  assert.deepEqual(research.deleted, [a]);
});

test("unknown route 404, wrong method 400, malformed id 404", async () => {
  const { call, create } = setup();
  const id = await create();
  assert.equal(errCode(await call("GET", "/v1/nothing")), "not_found");
  assert.equal((await call("GET", "/v1/nothing")).status, 404);
  const wrong = await call("POST", `/v1/seekers/${id}/profile`);
  assert.equal(wrong.status, 400);
  assert.equal(errCode(wrong), "bad_request");
  assert.equal((await call("GET", "/v1/seekers")).status, 400);
  assert.equal((await call("GET", "/v1/seekers/not-an-id/profile")).status, 404);
  assert.equal((await call("GET", `/v1/seekers/${id}/profile/`)).status, 200, "trailing slash tolerated");
});

test("an unexpected error is 500 internal without leaking its message", async () => {
  const { deps } = setup();
  deps.store.get = async () => {
    throw new Error("db password=hunter2");
  };
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await handle({ method: "GET", path: "/v1/seekers/skr_01M4EPBGAC0000000000000000/profile", headers: auth }, deps);
    assert.equal(r.status, 500);
    assert.equal(r.body.error?.message, "Internal error");
  } finally {
    console.error = orig;
  }
});
