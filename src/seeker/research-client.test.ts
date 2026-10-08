import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./core/errors.ts";
import { HttpResearchClient } from "./research-client.ts";

type Call = { url: string; method: string; auth: string | null };

// A fetch stand-in: answers from a function, records every call. Never the network.
function fakeFetch(answer: (url: URL, method: string) => { status: number; body: unknown } | Error) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ url: url.toString(), method, auth: new Headers(init?.headers).get("authorization") });
    const a = answer(url, method);
    if (a instanceof Error) throw a;
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
  return { impl, calls };
}

const env = (data: unknown, meta: object = {}) => ({ ok: true, data, error: null, meta: { requestId: "req_1", ...meta } });
const err = (code: string) => ({ ok: false, data: null, error: { code, message: code }, meta: { requestId: "req_1" } });
const upstream = (e: unknown) => e instanceof ApiError && e.code === "upstream_failed" && !/secret-key/.test(e.message);
const client = (f: ReturnType<typeof fakeFetch>) => new HttpResearchClient({ baseUrl: "http://part2.example.com/", apiKey: "secret-key", fetchImpl: f.impl });

test("listRuns pages through all runs with the Part 2 key", async () => {
  const f = fakeFetch((url) => {
    const page = Number(url.searchParams.get("page"));
    return { status: 200, body: env(page === 1 ? [{ runId: "run_1" }, { runId: "run_2" }] : [{ runId: "run_3" }], { page, pageSize: 100, total: 3 }) };
  });
  const runs = await client(f).listRuns("skr_A");
  assert.deepEqual(runs, [{ runId: "run_1" }, { runId: "run_2" }, { runId: "run_3" }]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, "http://part2.example.com/v1/seekers/skr_A/research-runs?page=1&pageSize=100");
  assert.equal(f.calls[0].auth, "Bearer secret-key");
});

test("listRuns without meta.total reads one page; not_found means no runs", async () => {
  assert.deepEqual(await client(fakeFetch(() => ({ status: 200, body: env([{ runId: "run_1" }]) }))).listRuns("skr_A"), [{ runId: "run_1" }]);
  assert.deepEqual(await client(fakeFetch(() => ({ status: 404, body: err("not_found") }))).listRuns("skr_A"), []);
});

test("deleteResearch calls DELETE /v1/seekers/{id}/research and needs deleted: true", async () => {
  const f = fakeFetch(() => ({ status: 200, body: env({ deleted: true, runs: 2 }) }));
  await client(f).deleteResearch("skr_A");
  assert.equal(f.calls[0].method, "DELETE");
  assert.equal(f.calls[0].url, "http://part2.example.com/v1/seekers/skr_A/research");
  await assert.rejects(client(fakeFetch(() => ({ status: 200, body: env({ deleted: false }) }))).deleteResearch("skr_A"), upstream);
});

test("every Part 2 failure is upstream_failed and never leaks the key", async () => {
  const cases: (() => { status: number; body: unknown } | Error)[] = [
    () => new TypeError("fetch failed"),
    () => ({ status: 500, body: err("internal") }),
    () => ({ status: 502, body: "<html>Bad gateway</html>" }),
    () => ({ status: 404, body: "Not Found" }), // no envelope: wrong base URL, not "no research"
    () => ({ status: 200, body: { hello: "world" } }),
    () => ({ status: 200, body: env("not an array") }),
  ];
  for (const c of cases) {
    await assert.rejects(client(fakeFetch(c)).listRuns("skr_A"), upstream);
    await assert.rejects(client(fakeFetch(c)).deleteResearch("skr_A"), upstream);
  }
});

test("missing config fails fast", () => {
  assert.throws(() => new HttpResearchClient({ baseUrl: "", apiKey: "k" }), /PART2_BASE_URL/);
  assert.throws(() => new HttpResearchClient({ baseUrl: "http://x.example.com", apiKey: "" }), /PART2_API_KEY/);
});
