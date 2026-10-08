import type { Roadmap } from "../roadmap/contracts.ts";
import { ApiError } from "./core/errors.ts";

// Part 1's runtime dependency on Part 4: the GDPR export and delete cascade.
export interface RoadmapClient {
  list(seekerId: string): Promise<Roadmap[]>; // GET /v1/seekers/{id}/roadmaps
  deleteAll(seekerId: string): Promise<void>; // DELETE /v1/seekers/{id}/roadmaps
}

type Envelope = { ok: boolean; data: unknown; error: { code: string; message: string } | null };

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === "object" && value !== null && "ok" in value && "data" in value && "error" in value;

// Calls Part 4 over HTTP. In the shared deployment all parts use the same base URL and API key.
export class HttpRoadmapClient implements RoadmapClient {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;

  constructor(opts: { baseUrl?: string; apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    const baseUrl = opts.baseUrl ?? process.env.PART4_BASE_URL ?? process.env.PART3_BASE_URL ?? process.env.PART2_BASE_URL;
    const apiKey = opts.apiKey ?? process.env.PART4_API_KEY ?? process.env.PART3_API_KEY ?? process.env.PART2_API_KEY;
    if (!baseUrl) throw new ApiError("internal", "PART4_BASE_URL, PART3_BASE_URL or PART2_BASE_URL is not set");
    if (!apiKey) throw new ApiError("internal", "PART4_API_KEY, PART3_API_KEY or PART2_API_KEY is not set");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async list(seekerId: string): Promise<Roadmap[]> {
    const env = await this.call("GET", `/v1/seekers/${encodeURIComponent(seekerId)}/roadmaps`);
    if (!env) return [];
    if (!Array.isArray(env.data)) throw new ApiError("upstream_failed", "Part 4 roadmaps: data is not an array");
    return env.data as Roadmap[];
  }

  async deleteAll(seekerId: string): Promise<void> {
    const env = await this.call("DELETE", `/v1/seekers/${encodeURIComponent(seekerId)}/roadmaps`);
    if (env && (env.data as { deleted?: unknown } | null)?.deleted !== true) {
      throw new ApiError("upstream_failed", "Part 4 did not confirm the delete");
    }
  }

  // Returns the ok envelope, null for not_found, throws upstream_failed otherwise.
  async call(method: string, path: string): Promise<Envelope | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ApiError("upstream_failed", `Part 4 ${method} ${path}: ${(error as Error).name}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("upstream_failed", `Part 4 ${method} ${path}: HTTP ${response.status}, not JSON`);
    }
    if (!isEnvelope(body)) throw new ApiError("upstream_failed", `Part 4 ${method} ${path}: HTTP ${response.status}, no envelope`);
    if (body.ok && response.ok) return body;
    if (response.status === 404 && body.error?.code === "not_found") return null;
    throw new ApiError("upstream_failed", `Part 4 ${method} ${path}: HTTP ${response.status}`);
  }
}

// Existing Part 1 deployments may not have Part 4 yet. Once configured, it joins the GDPR cascade.
export function roadmapClientFromEnv(): RoadmapClient | undefined {
  const baseUrl = process.env.PART4_BASE_URL ?? process.env.PART3_BASE_URL ?? process.env.PART2_BASE_URL;
  if (!baseUrl) return undefined;
  return new HttpRoadmapClient({ baseUrl });
}

export class FakeRoadmapClient implements RoadmapClient {
  roadmaps = new Map<string, Roadmap[]>();
  failDeletes = 0;
  failLists = false;
  deleted: string[] = [];

  async list(seekerId: string): Promise<Roadmap[]> {
    if (this.failLists) throw new ApiError("upstream_failed", "Part 4 is down (fake)");
    return structuredClone(this.roadmaps.get(seekerId) ?? []);
  }

  async deleteAll(seekerId: string): Promise<void> {
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new ApiError("upstream_failed", "Part 4 is down (fake)");
    }
    this.roadmaps.delete(seekerId);
    this.deleted.push(seekerId);
  }
}
