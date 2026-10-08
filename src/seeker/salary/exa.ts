import { ApiError } from "../core/errors.ts";

export type ExaResult = { url: string; title: string; text: string };

export interface ExaClient {
  search(query: string, numResults: number): Promise<ExaResult[]>;
}

type ExaResponse = {
  requestId?: unknown;
  results?: unknown;
  costDollars?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class HttpExaClient implements ExaClient {
  apiKey: string;
  fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async search(query: string, numResults: number): Promise<ExaResult[]> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ query, numResults, contents: { text: { maxCharacters: 4000 } } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiError("upstream_failed", "Search provider request failed");
    }

    if (!response.ok) {
      throw new ApiError("upstream_failed", `Search provider returned ${response.status}`);
    }

    let body: ExaResponse;
    try {
      body = (await response.json()) as ExaResponse;
    } catch {
      throw new ApiError("upstream_failed", "Search provider returned invalid JSON");
    }
    if (!Array.isArray(body.results)) {
      throw new ApiError("upstream_failed", "Search provider returned invalid results");
    }

    const results: ExaResult[] = [];
    for (const result of body.results) {
      if (
        !isObject(result) || typeof result.url !== "string" ||
        typeof result.title !== "string" || typeof result.text !== "string"
      ) {
        throw new ApiError("upstream_failed", "Search provider returned invalid results");
      }
      results.push({ url: result.url, title: result.title, text: result.text });
    }
    return results;
  }
}

export class FakeExa implements ExaClient {
  results: ExaResult[];
  calls: { query: string; numResults: number }[] = [];

  constructor(results: ExaResult[]) {
    this.results = structuredClone(results);
  }

  async search(query: string, numResults: number): Promise<ExaResult[]> {
    this.calls.push({ query, numResults });
    return structuredClone(this.results);
  }
}

export function exaFromEnv(): HttpExaClient | null {
  const apiKey = process.env.EXA_API_KEY;
  return apiKey ? new HttpExaClient(apiKey) : null;
}
