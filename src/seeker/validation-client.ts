import { ApiError } from "./core/errors.ts";

// Part 1's runtime dependency on Part 3: the GDPR export and delete cascade.
// Validation is Part 3's type, so validations pass through as unknown.
export interface ValidationClient {
  list(seekerId: string): Promise<unknown[]>; // GET /v1/seekers/{id}/validations
  deleteAll(seekerId: string): Promise<void>; // DELETE /v1/seekers/{id}/validations
}

type Envelope = { ok: boolean; data: unknown; error: { code: string; message: string } | null };

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === "object" && value !== null && "ok" in value && "data" in value && "error" in value;

// Calls Part 3 over HTTP. Part 3 normally shares Part 2's server, so both its
// base URL and API key fall back to the Part 2 configuration.
export class HttpValidationClient implements ValidationClient {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;

  constructor(opts: { baseUrl?: string; apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    const baseUrl = opts.baseUrl ?? process.env.PART3_BASE_URL ?? process.env.PART2_BASE_URL;
    const apiKey = opts.apiKey ?? process.env.PART3_API_KEY ?? process.env.PART2_API_KEY;
    if (!baseUrl) throw new ApiError("internal", "PART3_BASE_URL or PART2_BASE_URL is not set");
    if (!apiKey) throw new ApiError("internal", "PART3_API_KEY or PART2_API_KEY is not set");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async list(seekerId: string): Promise<unknown[]> {
    const env = await this.call("GET", `/v1/seekers/${encodeURIComponent(seekerId)}/validations`);
    if (!env) return [];
    if (!Array.isArray(env.data)) throw new ApiError("upstream_failed", "Part 3 validations: data is not an array");
    return env.data;
  }

  async deleteAll(seekerId: string): Promise<void> {
    const env = await this.call("DELETE", `/v1/seekers/${encodeURIComponent(seekerId)}/validations`);
    if (env && (env.data as { deleted?: unknown } | null)?.deleted !== true) {
      throw new ApiError("upstream_failed", "Part 3 did not confirm the delete");
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
      throw new ApiError("upstream_failed", `Part 3 ${method} ${path}: ${(error as Error).name}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("upstream_failed", `Part 3 ${method} ${path}: HTTP ${response.status}, not JSON`);
    }
    if (!isEnvelope(body)) throw new ApiError("upstream_failed", `Part 3 ${method} ${path}: HTTP ${response.status}, no envelope`);
    if (body.ok && response.ok) return body;
    if (response.status === 404 && body.error?.code === "not_found") return null;
    throw new ApiError("upstream_failed", `Part 3 ${method} ${path}: HTTP ${response.status}`);
  }
}

// Existing Part 1 deployments may not have Part 3 yet. With no known base URL,
// GDPR operations preserve their old behavior; once configured, Part 3 joins the cascade.
export function validationClientFromEnv(): ValidationClient | undefined {
  const baseUrl = process.env.PART3_BASE_URL ?? process.env.PART2_BASE_URL;
  if (!baseUrl) return undefined;
  return new HttpValidationClient({ baseUrl });
}

export class FakeValidationClient implements ValidationClient {
  validations = new Map<string, unknown[]>();
  failDeletes = 0;
  failLists = false;
  deleted: string[] = [];

  async list(seekerId: string): Promise<unknown[]> {
    if (this.failLists) throw new ApiError("upstream_failed", "Part 3 is down (fake)");
    return structuredClone(this.validations.get(seekerId) ?? []);
  }

  async deleteAll(seekerId: string): Promise<void> {
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new ApiError("upstream_failed", "Part 3 is down (fake)");
    }
    this.validations.delete(seekerId);
    this.deleted.push(seekerId);
  }
}
