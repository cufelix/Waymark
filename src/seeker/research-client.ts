import { ApiError } from "./core/errors.ts";
import type { CareerPath } from "./contracts.ts";

// Part 1's runtime dependency on Part 2: the GDPR cascade and career choice validation
// (API.md "How the parts connect").
// ResearchRun is Part 2's type, so runs pass through as unknown.
export interface ResearchClient {
  listRuns(seekerId: string): Promise<unknown[]>; // GET /v1/seekers/{id}/research-runs
  deleteResearch(seekerId: string): Promise<void>; // DELETE /v1/seekers/{id}/research
  getRun(runId: string): Promise<{ runId: string; seekerId: string } | null>; // GET /v1/research-runs/{runId}
  getCareerPaths(runId: string): Promise<CareerPath[] | null>; // GET /v1/research-runs/{runId}/career-paths
}

type Envelope = { ok: boolean; data: unknown; error: { code: string; message: string } | null; meta?: { page?: number; pageSize?: number; total?: number } };

const isEnvelope = (v: unknown): v is Envelope => typeof v === "object" && v !== null && "ok" in v && "data" in v && "error" in v;

const PAGE_SIZE = 100; // API.md: pageSize max 100
const MAX_PAGES = 100;

// Calls Part 2 over HTTP with its own API key (env PART2_BASE_URL, PART2_API_KEY).
// Any transport error, non-envelope reply or error envelope becomes upstream_failed (502).
// An error envelope with code "not_found" means Part 2 holds nothing for the seeker: listRuns
// returns [] and deleteResearch succeeds, so a retried delete stays idempotent.
export class HttpResearchClient implements ResearchClient {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;

  constructor(opts: { baseUrl?: string; apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    const baseUrl = opts.baseUrl ?? process.env.PART2_BASE_URL;
    const apiKey = opts.apiKey ?? process.env.PART2_API_KEY;
    if (!baseUrl) throw new ApiError("internal", "PART2_BASE_URL is not set");
    if (!apiKey) throw new ApiError("internal", "PART2_API_KEY is not set");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async listRuns(seekerId: string): Promise<unknown[]> {
    const runs: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const env = await this.call("GET", `/v1/seekers/${encodeURIComponent(seekerId)}/research-runs?page=${page}&pageSize=${PAGE_SIZE}`);
      if (!env) return runs; // not_found: no research for this seeker
      if (!Array.isArray(env.data)) throw new ApiError("upstream_failed", "Part 2 research-runs: data is not an array");
      runs.push(...env.data);
      const total = env.meta?.total;
      if (typeof total !== "number" || env.data.length === 0 || runs.length >= total) return runs;
    }
    throw new ApiError("upstream_failed", "Part 2 research-runs: too many pages");
  }

  async deleteResearch(seekerId: string): Promise<void> {
    const env = await this.call("DELETE", `/v1/seekers/${encodeURIComponent(seekerId)}/research`);
    if (env && (env.data as { deleted?: unknown } | null)?.deleted !== true) throw new ApiError("upstream_failed", "Part 2 did not confirm the delete");
  }

  async getRun(runId: string): Promise<{ runId: string; seekerId: string } | null> {
    const env = await this.call("GET", `/v1/research-runs/${encodeURIComponent(runId)}`);
    if (!env) return null;
    if (typeof env.data !== "object" || env.data === null) throw new ApiError("upstream_failed", "Part 2 research run: data is not an object");
    const run = env.data as { runId?: unknown; seekerId?: unknown };
    if (typeof run.runId !== "string" || typeof run.seekerId !== "string") {
      throw new ApiError("upstream_failed", "Part 2 research run: runId or seekerId is missing");
    }
    if (run.runId !== runId) throw new ApiError("upstream_failed", "Part 2 research run: runId does not match the request");
    return { runId: run.runId, seekerId: run.seekerId };
  }

  async getCareerPaths(runId: string): Promise<CareerPath[] | null> {
    const env = await this.call("GET", `/v1/research-runs/${encodeURIComponent(runId)}/career-paths`);
    if (!env) return null;
    if (!Array.isArray(env.data)) throw new ApiError("upstream_failed", "Part 2 career-paths: data is not an array");
    for (const path of env.data) {
      if (
        typeof path !== "object" ||
        path === null ||
        typeof (path as { occupation?: { uri?: unknown } }).occupation !== "object" ||
        (path as { occupation?: { uri?: unknown } }).occupation === null ||
        typeof (path as { occupation: { uri?: unknown } }).occupation.uri !== "string" ||
        typeof (path as { occupation: { label?: unknown } }).occupation.label !== "string" ||
        typeof (path as { occupation: { lang?: unknown } }).occupation.lang !== "string" ||
        !Array.isArray((path as { why?: unknown }).why) ||
        typeof (path as { vacancyCount?: unknown }).vacancyCount !== "number"
      ) {
        throw new ApiError("upstream_failed", "Part 2 career-paths: path occupation is missing");
      }
    }
    return env.data as CareerPath[];
  }

  // Returns the ok envelope, null for a not_found envelope, throws upstream_failed otherwise.
  async call(method: string, path: string): Promise<Envelope | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ApiError("upstream_failed", `Part 2 ${method} ${path.split("?")[0]}: ${(e as Error).name}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError("upstream_failed", `Part 2 ${method} ${path.split("?")[0]}: HTTP ${res.status}, not JSON`);
    }
    if (!isEnvelope(body)) throw new ApiError("upstream_failed", `Part 2 ${method} ${path.split("?")[0]}: HTTP ${res.status}, no envelope`);
    if (body.ok && res.ok) return body;
    if (res.status === 404 && body.error?.code === "not_found") return null;
    throw new ApiError("upstream_failed", `Part 2 ${method} ${path.split("?")[0]}: HTTP ${res.status}`);
  }
}

// Tests: runs per seeker, and a switch to make deletes fail N times.
export class FakeResearchClient implements ResearchClient {
  runs = new Map<string, unknown[]>();
  runsById = new Map<string, { runId: string; seekerId: string }>();
  careerPaths = new Map<string, CareerPath[]>();
  failDeletes = 0;
  failLists = false;
  failRunGets = false;
  failCareerPathGets = false;
  deleted: string[] = [];

  seedRun(runId: string, seekerId: string, paths: CareerPath[] = []): void {
    const run = { runId, seekerId };
    this.runsById.set(runId, run);
    this.careerPaths.set(runId, structuredClone(paths));
    const seekerRuns = this.runs.get(seekerId) ?? [];
    this.runs.set(seekerId, [...seekerRuns.filter((candidate) => (candidate as { runId?: unknown })?.runId !== runId), run]);
  }

  async listRuns(seekerId: string): Promise<unknown[]> {
    if (this.failLists) throw new ApiError("upstream_failed", "Part 2 is down (fake)");
    return structuredClone(this.runs.get(seekerId) ?? []);
  }

  async deleteResearch(seekerId: string): Promise<void> {
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new ApiError("upstream_failed", "Part 2 is down (fake)");
    }
    this.runs.delete(seekerId);
    for (const [runId, run] of this.runsById) {
      if (run.seekerId !== seekerId) continue;
      this.runsById.delete(runId);
      this.careerPaths.delete(runId);
    }
    this.deleted.push(seekerId);
  }

  async getRun(runId: string): Promise<{ runId: string; seekerId: string } | null> {
    if (this.failRunGets) throw new ApiError("upstream_failed", "Part 2 is down (fake)");
    return structuredClone(this.runsById.get(runId) ?? null);
  }

  async getCareerPaths(runId: string): Promise<CareerPath[] | null> {
    if (this.failCareerPathGets) throw new ApiError("upstream_failed", "Part 2 is down (fake)");
    const paths = this.careerPaths.get(runId);
    return paths ? structuredClone(paths) : null;
  }
}
