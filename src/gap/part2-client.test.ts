import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../seeker/core/errors.ts";
import { HttpPart2Client } from "./part2-client.ts";
import { COMPANIES, OCC, RUN, VACANCIES } from "./testdata/run.ts";

const json = (data: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(data), {
  status: 200,
  headers: { "content-type": "application/json" },
  ...init,
});

test("paginates companies and occupation-filtered vacancies with bearer auth", async () => {
  const urls: URL[] = [];
  const auth: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url);
    auth.push(new Headers(init?.headers).get("authorization") ?? "");
    const page = Number(url.searchParams.get("page"));
    const values = url.pathname.endsWith("/companies") ? COMPANIES : VACANCIES;
    const data = page === 1 ? values.slice(0, 1) : values.slice(1);
    return json({ ok: true, data, error: null, meta: { requestId: "req_test", page, pageSize: 100, total: values.length } });
  };
  const client = new HttpPart2Client({ baseUrl: "https://research.example/", apiKey: "part2-secret", fetchImpl });

  assert.deepEqual(await client.listCompanies(RUN.runId), COMPANIES);
  assert.deepEqual(await client.listVacancies(RUN.runId, OCC.uri), VACANCIES);
  assert.equal(urls.length, 4);
  assert.ok(urls.every((url) => url.searchParams.get("pageSize") === "100"));
  assert.deepEqual(urls.map((url) => url.searchParams.get("page")), ["1", "2", "1", "2"]);
  assert.equal(urls.at(2)?.searchParams.get("occupation"), OCC.uri);
  assert.ok(auth.every((value) => value === "Bearer part2-secret"));
});

test("getRun maps only a 404 to null", async () => {
  const missing = new HttpPart2Client({
    baseUrl: "https://research.example",
    apiKey: "key",
    fetchImpl: async () => json({ private: "body" }, { status: 404 }),
  });
  assert.equal(await missing.getRun("run_missing"), null);

  const otherRoute = new HttpPart2Client({
    baseUrl: "https://research.example",
    apiKey: "key",
    fetchImpl: async () => json({ private: "body" }, { status: 404 }),
  });
  await assert.rejects(() => otherRoute.getMarket("run_missing"), (error) => (
    error instanceof ApiError && error.code === "upstream_failed" && error.message === "Research service returned 404"
  ));
});

test("non-OK responses become sanitized upstream_failed errors", async () => {
  const client = new HttpPart2Client({
    baseUrl: "https://research.example",
    apiKey: "key",
    fetchImpl: async () => json({ ok: false, error: { message: "database password is swordfish" } }, { status: 503 }),
  });
  await assert.rejects(() => client.getMarket(RUN.runId), (error) => (
    error instanceof ApiError
      && error.code === "upstream_failed"
      && error.message === "Research service returned 503"
      && !error.message.includes("swordfish")
  ));
});

test("missing Part 2 configuration fails fast", () => {
  const oldUrl = process.env.PART2_BASE_URL;
  const oldKey = process.env.PART2_API_KEY;
  delete process.env.PART2_BASE_URL;
  delete process.env.PART2_API_KEY;
  try {
    assert.throws(() => new HttpPart2Client(), (error) => error instanceof ApiError && error.code === "internal");
  } finally {
    if (oldUrl === undefined) delete process.env.PART2_BASE_URL;
    else process.env.PART2_BASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.PART2_API_KEY;
    else process.env.PART2_API_KEY = oldKey;
  }
});
