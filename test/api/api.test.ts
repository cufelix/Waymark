import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.API_KEYS = "test-key-1, test-key-2";
  process.env.DATABASE_URL = "postgres://research:research@localhost:5433/research";
});

vi.mock("../../src/research/user/index", () => ({ researchSeeker: vi.fn() }));
vi.mock("../../src/research/market/index", () => ({ researchMarket: vi.fn() }));
vi.mock("../../src/research/market/read", () => ({
  getCompany: vi.fn(),
  getVacancy: vi.fn(),
  listRunCompanies: vi.fn(),
  listRunVacancies: vi.fn(),
}));

import { createApp } from "../../src/api/app";
import { pool, query } from "../../src/db/pool";
import { researchMarket } from "../../src/research/market/index";
import { listRunCompanies } from "../../src/research/market/read";
import { processRun, stopBoss } from "../../src/research/run";
import { researchSeeker } from "../../src/research/user/index";

const KEY = { authorization: "Bearer test-key-1" };
const JSON_HEADERS = { ...KEY, "content-type": "application/json" };
const SEEKER = `skr_test_api_${Date.now().toString(36)}`;
const OTHER_SEEKER = `${SEEKER}_other`;

const fixture = JSON.parse(readFileSync(new URL("./fixtures/junior-backend.json", import.meta.url), "utf8"));
const profile = (over: Record<string, unknown> = {}) => ({ ...structuredClone(fixture), seekerId: SEEKER, ...over });

const MARKET = {
  careerPaths: [],
  companyIds: ["cmp_1", "cmp_2"],
  vacancyIds: ["vac_1"],
  market: [],
};
const SEEKER_RESEARCH = { links: [] };

const app = createApp({ rateLimitPerMinute: 1000 });
const created: string[] = [];

type Envelope = { ok: boolean; data: any; error: { code: string; message: string } | null; meta: Record<string, any> };
async function call(path: string, init: RequestInit = {}, a = app): Promise<{ status: number; body: Envelope }> {
  const res = await a.request(path, init);
  return { status: res.status, body: (await res.json()) as Envelope };
}
const post = (body: unknown, headers = JSON_HEADERS) =>
  call("/v1/research-runs", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

async function startDone(p = profile()): Promise<string> {
  const { body } = await post({ profile: p });
  const runId = body.data.runId as string;
  created.push(runId);
  await processRun(runId);
  return runId;
}

beforeEach(() => {
  vi.mocked(researchMarket).mockReset().mockResolvedValue(MARKET);
  vi.mocked(researchSeeker).mockReset().mockResolvedValue(SEEKER_RESEARCH);
  vi.mocked(listRunCompanies).mockReset();
});

afterAll(async () => {
  const ids = [...created];
  await query("DELETE FROM research_runs WHERE seeker_id = ANY($1)", [[SEEKER, OTHER_SEEKER]]);
  // queued jobs this file put on the pg-boss queue
  await query("DELETE FROM pgboss.job WHERE name = 'research-run' AND data->>'runId' = ANY($1)", [ids]).catch(() => undefined);
  await stopBoss();
  await pool.end();
});

describe("auth", () => {
  it("401 without a Bearer key", async () => {
    const r = await call("/v1/research-runs/run_x");
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe("unauthorized");
  });

  it("401 for a wrong key and for a non-Bearer scheme", async () => {
    expect((await call("/v1/research-runs/run_x", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await call("/v1/research-runs/run_x", { headers: { authorization: "Basic test-key-1" } })).status).toBe(401);
  });

  it("accepts any configured key; /health needs none", async () => {
    expect((await call("/v1/research-runs/run_x", { headers: { authorization: "Bearer test-key-2" } })).status).toBe(404);
    expect((await call("/health")).status).toBe(200);
  });
});

describe("envelope", () => {
  it("success: ok, data, null error, meta.requestId", async () => {
    const r = await call("/health");
    expect(r.body).toMatchObject({ ok: true, data: { status: "ok" }, error: null });
    expect(r.body.meta.requestId).toMatch(/^req_/);
  });

  it("error: not ok, null data, code and message, meta.requestId", async () => {
    const r = await call("/v1/research-runs/run_missing", { headers: KEY });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ ok: false, data: null, error: { code: "not_found" } });
    expect(typeof r.body.error?.message).toBe("string");
    expect(r.body.meta.requestId).toMatch(/^req_/);
  });

  it("unknown routes use the envelope too, with a fresh requestId each call", async () => {
    const a = await call("/v1/nothing", { headers: KEY });
    const b = await call("/v1/nothing", { headers: KEY });
    expect(a.body).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(a.body.meta.requestId).not.toBe(b.body.meta.requestId);
  });
});

describe("POST /v1/research-runs validation", () => {
  it("400 for a body that is not JSON", async () => {
    const r = await post("{nope");
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("bad_request");
  });

  it("422 for a body without a profile", async () => {
    const r = await post({});
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe("unprocessable");
  });

  it("422 for unknown fields", async () => {
    expect((await post({ profile: profile(), extra: 1 })).status).toBe(422);
  });

  it("422 when the profile is incomplete", async () => {
    const r = await post({ profile: profile({ status: "incomplete" }) });
    expect(r.status).toBe(422);
    expect(r.body.error?.message).toContain("complete");
  });

  it("422 when there is no target occupation", async () => {
    const p = profile();
    p.preferences.targetOccupations = [];
    const r = await post({ profile: p });
    expect(r.status).toBe(422);
    expect(r.body.error?.message).toContain("targetOccupations");
  });
});

describe("run lifecycle", () => {
  it("queued run → processRun → done with the mocked result", async () => {
    const started = await post({ profile: profile() });
    expect(started.status).toBe(202);
    expect(started.body.data).toMatchObject({ status: "queued" });
    const runId = started.body.data.runId as string;
    created.push(runId);
    expect(runId).toMatch(/^run_/);

    const queued = await call(`/v1/research-runs/${runId}`, { headers: KEY });
    expect(queued.body.data).toMatchObject({ runId, seekerId: SEEKER, profileVersion: 3, status: "queued" });
    expect(queued.body.data.result).toBeUndefined();

    await processRun(runId);

    const done = await call(`/v1/research-runs/${runId}`, { headers: KEY });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("done");
    expect(done.body.data.result).toEqual({ ...MARKET, seekerResearch: SEEKER_RESEARCH });
    expect(researchMarket).toHaveBeenCalledTimes(1);
    expect(researchSeeker).toHaveBeenCalledTimes(1);

    const paths = await call(`/v1/research-runs/${runId}/career-paths`, { headers: KEY });
    expect(paths.body.data).toEqual(MARKET.careerPaths);
    const sr = await call(`/v1/research-runs/${runId}/seeker-research`, { headers: KEY });
    expect(sr.body.data).toEqual(SEEKER_RESEARCH);
  });

  it("a failing research step stores status failed", async () => {
    vi.mocked(researchMarket).mockRejectedValue(new Error("boom"));
    const runId = await startDone();
    const r = await call(`/v1/research-runs/${runId}`, { headers: KEY });
    expect(r.body.data.status).toBe("failed");
    expect(r.body.data.error).toMatchObject({ code: "internal" });
    expect((await call(`/v1/research-runs/${runId}/market`, { headers: KEY })).status).toBe(409);
  });

  it("409 for every sub-resource before the run is done", async () => {
    const { body } = await post({ profile: profile() });
    const runId = body.data.runId as string;
    created.push(runId);
    for (const sub of ["career-paths", "market", "seeker-research", "companies", "vacancies"]) {
      const r = await call(`/v1/research-runs/${runId}/${sub}`, { headers: KEY });
      expect(r.status, sub).toBe(409);
      expect(r.body.error?.code).toBe("conflict");
    }
  });

  it("404 for a sub-resource of an unknown run", async () => {
    expect((await call("/v1/research-runs/run_missing/market", { headers: KEY })).status).toBe(404);
  });
});

describe("paging", () => {
  it("meta carries page, pageSize and total for /companies", async () => {
    vi.mocked(listRunCompanies).mockResolvedValue({ items: [{ id: "cmp_1" }, { id: "cmp_2" }] as never, total: 42 });
    const runId = await startDone();
    const r = await call(`/v1/research-runs/${runId}/companies?page=2&pageSize=10`, { headers: KEY });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.meta).toMatchObject({ page: 2, pageSize: 10, total: 42 });
    expect(listRunCompanies).toHaveBeenCalledWith(runId, 2, 10);
  });

  it("defaults to page 1, pageSize 20", async () => {
    vi.mocked(listRunCompanies).mockResolvedValue({ items: [], total: 0 });
    const runId = await startDone();
    const r = await call(`/v1/research-runs/${runId}/companies`, { headers: KEY });
    expect(r.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 0 });
  });

  it("400 for pageSize over 100 and for page 0", async () => {
    const runId = await startDone();
    expect((await call(`/v1/research-runs/${runId}/companies?pageSize=101`, { headers: KEY })).status).toBe(400);
    expect((await call(`/v1/research-runs/${runId}/companies?page=0`, { headers: KEY })).status).toBe(400);
  });
});

describe("GDPR deletes", () => {
  it("DELETE /v1/seekers/:id/research removes that seeker's runs only", async () => {
    const a = await startDone();
    const b = await startDone();
    const keep = await startDone(profile({ seekerId: OTHER_SEEKER }));

    const list = await call(`/v1/seekers/${SEEKER}/research-runs`, { headers: KEY });
    expect(list.body.data.map((r: { runId: string }) => r.runId)).toEqual(expect.arrayContaining([a, b]));

    const del = await call(`/v1/seekers/${SEEKER}/research`, { method: "DELETE", headers: KEY });
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
    expect(del.body.data.runs).toBeGreaterThanOrEqual(2);

    expect((await call(`/v1/research-runs/${a}`, { headers: KEY })).status).toBe(404);
    expect((await call(`/v1/research-runs/${b}`, { headers: KEY })).status).toBe(404);
    expect((await call(`/v1/seekers/${SEEKER}/research-runs`, { headers: KEY })).body.data).toEqual([]);
    expect((await call(`/v1/research-runs/${keep}`, { headers: KEY })).status).toBe(200);
  });

  it("DELETE /v1/research-runs/:id deletes one run, then 404", async () => {
    const runId = await startDone();
    expect((await call(`/v1/research-runs/${runId}`, { method: "DELETE", headers: KEY })).body.data).toEqual({ deleted: true });
    const again = await call(`/v1/research-runs/${runId}`, { method: "DELETE", headers: KEY });
    expect(again.status).toBe(404);
  });
});

describe("rate limit", () => {
  it("429 after the per-minute budget, with the envelope", async () => {
    const limited = createApp({ rateLimitPerMinute: 3 });
    const hit = () => call("/v1/research-runs/run_x", { headers: KEY }, limited);
    expect((await hit()).status).toBe(404);
    expect((await hit()).status).toBe(404);
    expect((await hit()).status).toBe(404);
    const r = await hit();
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ ok: false, data: null, error: { code: "rate_limited" } });
    expect(r.body.meta.requestId).toMatch(/^req_/);
  });

  it("budgets are per key", async () => {
    const limited = createApp({ rateLimitPerMinute: 1 });
    await call("/v1/research-runs/run_x", { headers: KEY }, limited);
    expect((await call("/v1/research-runs/run_x", { headers: KEY }, limited)).status).toBe(429);
    const other = await call("/v1/research-runs/run_x", { headers: { authorization: "Bearer test-key-2" } }, limited);
    expect(other.status).toBe(404);
  });
});
