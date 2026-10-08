import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ApiError } from "./core/errors.ts";
import { HttpRoadmapClient } from "./roadmap-client.ts";

type Call = { url: string; method: string; auth: string | null };

// A fetch stand-in: answers from a function, records every call. Never the network.
function fakeFetch(answer: () => { status: number; body: unknown } | Error) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(input), method, auth: new Headers(init?.headers).get("authorization") });
    const result = answer();
    if (result instanceof Error) throw result;
    return new Response(typeof result.body === "string" ? result.body : JSON.stringify(result.body), { status: result.status });
  }) as typeof fetch;
  return { impl, calls };
}

const env = (data: unknown) => ({ ok: true, data, error: null, meta: { requestId: "req_1" } });
const err = (code: string) => ({ ok: false, data: null, error: { code, message: code }, meta: { requestId: "req_1" } });
const upstream = (error: unknown) => error instanceof ApiError && error.code === "upstream_failed" && !/secret-key/.test(error.message);
const client = (f: ReturnType<typeof fakeFetch>) =>
  new HttpRoadmapClient({ baseUrl: "http://part4.example.com/", apiKey: "secret-key", fetchImpl: f.impl });

test("list gets a seeker's roadmaps with the Part 4 key", async () => {
  const f = fakeFetch(() => ({ status: 200, body: env([{ roadmapId: "rmp_1" }]) }));
  assert.deepEqual(await client(f).list("skr_A"), [{ roadmapId: "rmp_1" }]);
  assert.deepEqual(f.calls, [{
    url: "http://part4.example.com/v1/seekers/skr_A/roadmaps",
    method: "GET",
    auth: "Bearer secret-key",
  }]);
});

test("deleteAll calls the roadmap cascade endpoint and requires deleted: true", async () => {
  const f = fakeFetch(() => ({ status: 200, body: env({ deleted: true, roadmaps: 2 }) }));
  await client(f).deleteAll("skr_A");
  assert.equal(f.calls[0]?.method, "DELETE");
  assert.equal(f.calls[0]?.url, "http://part4.example.com/v1/seekers/skr_A/roadmaps");
  await assert.rejects(client(fakeFetch(() => ({ status: 200, body: env({ deleted: false }) }))).deleteAll("skr_A"), upstream);
});

test("not_found means no roadmaps and an already-complete delete", async () => {
  const f = fakeFetch(() => ({ status: 404, body: err("not_found") }));
  assert.deepEqual(await client(f).list("skr_A"), []);
  await client(f).deleteAll("skr_A");
});

test("every Part 4 failure is upstream_failed and never leaks the key", async () => {
  const cases: (() => { status: number; body: unknown } | Error)[] = [
    () => new TypeError("fetch failed"),
    () => ({ status: 500, body: err("internal") }),
    () => ({ status: 502, body: "<html>Bad gateway</html>" }),
    () => ({ status: 404, body: "Not Found" }),
    () => ({ status: 200, body: { hello: "world" } }),
    () => ({ status: 200, body: env("not an array") }),
  ];
  for (const answer of cases) await assert.rejects(client(fakeFetch(answer)).list("skr_A"), upstream);
});

test("missing config fails fast", () => {
  assert.throws(() => new HttpRoadmapClient({ baseUrl: "", apiKey: "k" }), /PART4_BASE_URL/);
  assert.throws(() => new HttpRoadmapClient({ baseUrl: "http://x.example.com", apiKey: "" }), /PART4_API_KEY/);
});

test("the shared Part 1 server injects a roadmap client with the research client connection", () => {
  const adapter = readFileSync(new URL("../api/part1.ts", import.meta.url), "utf8");

  assert.match(adapter, /import\(at\("roadmap-client\.ts"\)\)/);
  assert.match(adapter, /research:\s*new research\.HttpResearchClient\(\{ baseUrl, apiKey \}\)/);
  assert.match(adapter, /roadmaps:\s*new roadmap\.HttpRoadmapClient\(\{ baseUrl, apiKey \}\)/);
});
