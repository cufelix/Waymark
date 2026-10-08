import { ApiError } from "./core/errors.ts";

// Part 1's only runtime dependency on Part 2: the GDPR cascade (API.md "How the parts connect").
// ResearchRun is Part 2's type, so runs pass through as unknown.
export interface ResearchClient {
  listRuns(seekerId: string): Promise<unknown[]>; // GET /v1/seekers/{id}/research-runs
  deleteResearch(seekerId: string): Promise<void>; // DELETE /v1/seekers/{id}/research
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
    if (body.error?.code === "not_found") return null;
    throw new ApiError("upstream_failed", `Part 2 ${method} ${path.split("?")[0]}: ${body.error?.code ?? `HTTP ${res.status}`}`);
  }
}

// Tests: runs per seeker, and a switch to make deletes fail N times.
export class FakeResearchClient implements ResearchClient {
  runs = new Map<string, unknown[]>();
  failDeletes = 0;
  failLists = false;
  deleted: string[] = [];

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
    this.deleted.push(seekerId);
  }
}
