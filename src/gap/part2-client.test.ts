import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../seeker/core/errors.ts";
import { HttpPart2Client } from "./part2-client.ts";
import { CAREER_PATHS, COMPANIES, MARKET, OCC, RUN, SEEKER_RESEARCH, TRENDS, VACANCIES } from "./testdata/run.ts";

const json = (data: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(data), {
  status: 200,
  headers: { "content-type": "application/json" },
  ...init,
});

const unexpectedResponse = (error: unknown) => error instanceof ApiError
  && error.code === "upstream_failed"
  && error.status === 502
  && error.message === "Research service returned an unexpected response";

const clientReturning = (data: unknown): HttpPart2Client => new HttpPart2Client({
  baseUrl: "https://research.example",
  apiKey: "key",
  fetchImpl: async () => json({ ok: true, data, error: null }),
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

test("accepts valid elements from every Part 2 endpoint", async () => {
  const claim = {
    ...SEEKER_RESEARCH.links[0].provenSkills[0],
    sources: SEEKER_RESEARCH.links[0].provenSkills[0]!.sources.map((source) => ({ ...source, tool: "official-api" as const })),
    validUntil: "2027-10-08T21:00:00Z",
  };
  const careerPaths = [{
    ...CAREER_PATHS[0],
    ladder: [{
      level: "lead",
      title: "Lead backend developer",
      occupation: OCC,
      typicalExperienceYears: { min: 5, max: 8 },
      salary: {
        p25: 90_000,
        median: 110_000,
        p75: 130_000,
        currency: "CZK",
        period: "month",
        sampleSize: 17,
        location: { country: "CZ", city: "Prague" },
      },
      claims: [claim],
    }],
  }];
  const seekerResearch = {
    ...SEEKER_RESEARCH,
    nameSearch: { candidates: [{ url: "https://example.com/jane", title: "Jane Example", snippet: "Backend developer in Prague" }] },
  };
  const client = new HttpPart2Client({
    baseUrl: "https://research.example",
    apiKey: "key",
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      const data = path.endsWith("/career-paths") ? careerPaths
        : path.endsWith("/market") ? MARKET
        : path.endsWith("/trends") ? [TRENDS]
        : path.endsWith("/seeker-research") ? seekerResearch
        : path.endsWith("/companies") ? COMPANIES
        : path.endsWith("/vacancies") ? VACANCIES
        : RUN;
      return json({ ok: true, data, error: null, meta: { total: Array.isArray(data) ? data.length : undefined } });
    },
  });

  assert.deepEqual(await client.getRun(RUN.runId), RUN);
  assert.deepEqual(await client.getCareerPaths(RUN.runId), careerPaths);
  assert.deepEqual(await client.getMarket(RUN.runId), MARKET);
  assert.deepEqual(await client.getTrends(RUN.runId), [TRENDS]);
  assert.deepEqual(await client.getSeekerResearch(RUN.runId), seekerResearch);
  assert.deepEqual(await client.listCompanies(RUN.runId), COMPANIES);
  assert.deepEqual(await client.listVacancies(RUN.runId, OCC.uri), VACANCIES);
});

test("rejects each newly checked malformed optional or nested field", async (t) => {
  const step = CAREER_PATHS[0].ladder![0];
  const claim = SEEKER_RESEARCH.links[0].provenSkills[0];
  const validSalary = {
    median: 110_000,
    currency: "CZK",
    period: "month",
    sampleSize: 17,
    location: { country: "CZ", city: "Prague" },
  };
  const careerPathWithStep = (patch: Record<string, unknown>) => [{
    ...CAREER_PATHS[0],
    ladder: [{ ...step, ...patch }],
  }];
  const careerPathWithClaim = (nextClaim: unknown) => [{
    ...CAREER_PATHS[0],
    why: [nextClaim],
  }];
  const cases: { name: string; data: unknown; call: (client: HttpPart2Client) => Promise<unknown> }[] = [
    {
      name: "CareerStep occupation",
      data: careerPathWithStep({ occupation: { ...OCC, uri: 42 } }),
      call: (client) => client.getCareerPaths(RUN.runId),
    },
    {
      name: "CareerStep typicalExperienceYears",
      data: careerPathWithStep({ typicalExperienceYears: { min: "five", max: 8 } }),
      call: (client) => client.getCareerPaths(RUN.runId),
    },
    {
      name: "CareerStep salary",
      data: careerPathWithStep({ salary: { ...validSalary, period: "week" } }),
      call: (client) => client.getCareerPaths(RUN.runId),
    },
    {
      name: "Claim subject kind",
      data: careerPathWithClaim({ ...claim, subject: { ...claim.subject, kind: "person" } }),
      call: (client) => client.getCareerPaths(RUN.runId),
    },
    {
      name: "Claim validUntil",
      data: careerPathWithClaim({ ...claim, validUntil: 1_799_280_000 }),
      call: (client) => client.getCareerPaths(RUN.runId),
    },
    {
      name: "Source tool",
      data: careerPathWithClaim({ ...claim, sources: [{ ...claim.sources[0], tool: "browser" }] }),
      call: (client) => client.getCareerPaths(RUN.runId),
    },
    {
      name: "SeekerResearch nameSearch",
      data: { ...SEEKER_RESEARCH, nameSearch: { candidates: [{ url: "https://example.com/jane", title: "Jane", snippet: 7 }] } },
      call: (client) => client.getSeekerResearch(RUN.runId),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await assert.rejects(() => entry.call(clientReturning(entry.data)), unexpectedResponse);
    });
  }
});

test("paged responses require a numeric meta.total", async (t) => {
  for (const [name, meta] of [
    ["missing total", { page: 1, pageSize: 100 }],
    ["non-numeric total", { page: 1, pageSize: 100, total: "2" }],
  ] as const) {
    await t.test(name, async () => {
      const client = new HttpPart2Client({
        baseUrl: "https://research.example",
        apiKey: "key",
        fetchImpl: async () => json({ ok: true, data: COMPANIES, error: null, meta }),
      });
      await assert.rejects(() => client.listCompanies(RUN.runId), unexpectedResponse);
    });
  }
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

test("successful responses with unexpected shapes become a consistent upstream_failed error", async () => {
  const cases: { data: unknown; call: (client: HttpPart2Client) => Promise<unknown> }[] = [
    { data: null, call: (client) => client.getRun(RUN.runId) },
    { data: { ...RUN, profileVersion: "3" }, call: (client) => client.getRun(RUN.runId) },
    { data: { ...RUN, runId: "run_OTHER" }, call: (client) => client.getRun(RUN.runId) },
    { data: {}, call: (client) => client.getCareerPaths(RUN.runId) },
    { data: [{}], call: (client) => client.getCareerPaths(RUN.runId) },
    { data: {}, call: (client) => client.getMarket(RUN.runId) },
    { data: [{}], call: (client) => client.getMarket(RUN.runId) },
    { data: {}, call: (client) => client.getTrends(RUN.runId) },
    { data: [{}], call: (client) => client.getTrends(RUN.runId) },
    { data: {}, call: (client) => client.listCompanies(RUN.runId) },
    { data: [{}], call: (client) => client.listCompanies(RUN.runId) },
    { data: {}, call: (client) => client.listVacancies(RUN.runId, OCC.uri) },
    { data: [{}], call: (client) => client.listVacancies(RUN.runId, OCC.uri) },
    { data: {}, call: (client) => client.getSeekerResearch(RUN.runId) },
    { data: { links: {} }, call: (client) => client.getSeekerResearch(RUN.runId) },
    { data: { links: [{}] }, call: (client) => client.getSeekerResearch(RUN.runId) },
  ];

  for (const entry of cases) {
    const client = new HttpPart2Client({
      baseUrl: "https://research.example",
      apiKey: "key",
      fetchImpl: async () => json({ ok: true, data: entry.data, error: null }),
    });
    await assert.rejects(() => entry.call(client), unexpectedResponse);
  }
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
