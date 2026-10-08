import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, type ApiDeps, type ApiRequest } from "./api.ts";
import { FakeLlm } from "./llm/llm.ts";
import { FakeResearchClient } from "./research-client.ts";
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

function setup() {
  const research = new FakeResearchClient();
  const deps: ApiDeps = { store: new MemoryStore(), llm: new FakeLlm([]), research, apiKeys: [KEY] };
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
  const documentId = (uploaded.body.data as any).id as string;
  assert.match(documentId, /^doc_/);

  const deleted = await call("DELETE", `/v1/seekers/${id}/documents/${documentId}`);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.data, { deleted: true });
  assert.deepEqual(((await call("GET", `/v1/seekers/${id}/profile`)).body.data as any).documents, []);
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
