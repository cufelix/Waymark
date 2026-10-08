import { ApiError } from "../seeker/core/errors.ts";
import type { CareerPath, Company, JobMarket, OccupationTrends, ResearchRunHead, SeekerResearch, Vacancy } from "./contracts.ts";

// Reads a finished run from Part 2 over HTTP (API.md "Part 2: Research"). null = 404.
// Owner: worker service.
export interface Part2Client {
  getRun(runId: string): Promise<ResearchRunHead | null>;
  getCareerPaths(runId: string): Promise<CareerPath[]>;
  getMarket(runId: string): Promise<JobMarket[]>;
  getTrends(runId: string): Promise<OccupationTrends[]>;
  getSeekerResearch(runId: string): Promise<SeekerResearch>;
  listCompanies(runId: string): Promise<Company[]>; // all pages
  listVacancies(runId: string, occupationUri: string): Promise<Vacancy[]>; // all pages, ?occupation=
}

type UpstreamEnvelope = {
  ok: boolean;
  data: unknown;
  meta?: { page?: number; pageSize?: number; total?: number };
};

export type FakePart2Data = {
  run: ResearchRunHead;
  careerPaths: CareerPath[];
  market: JobMarket[];
  trends: OccupationTrends[];
  seekerResearch: SeekerResearch;
  companies: Company[];
  vacancies: Vacancy[];
};

const PAGE_SIZE = 100;
const MAX_PAGES = 10_000;

function isEnvelope(value: unknown): value is UpstreamEnvelope {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean" && "data" in value;
}

// Reads Part 2's response envelope but never repeats its response body in an error.
export class HttpPart2Client implements Part2Client {
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

  async getRun(runId: string): Promise<ResearchRunHead | null> {
    const data = await this.read(`/v1/research-runs/${encodeURIComponent(runId)}`, true);
    return data === null ? null : data as ResearchRunHead;
  }

  async getCareerPaths(runId: string): Promise<CareerPath[]> {
    return await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/career-paths`) as CareerPath[];
  }

  async getMarket(runId: string): Promise<JobMarket[]> {
    return await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/market`) as JobMarket[];
  }

  async getTrends(runId: string): Promise<OccupationTrends[]> {
    return await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/trends`) as OccupationTrends[];
  }

  async getSeekerResearch(runId: string): Promise<SeekerResearch> {
    return await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/seeker-research`) as SeekerResearch;
  }

  async listCompanies(runId: string): Promise<Company[]> {
    return await this.readPages(`/v1/research-runs/${encodeURIComponent(runId)}/companies`);
  }

  async listVacancies(runId: string, occupationUri: string): Promise<Vacancy[]> {
    const path = `/v1/research-runs/${encodeURIComponent(runId)}/vacancies?occupation=${encodeURIComponent(occupationUri)}`;
    return await this.readPages(path);
  }

  private async readPages<T>(path: string): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const envelope = await this.request(`${path}${separator}page=${page}&pageSize=${PAGE_SIZE}`);
      if (!envelope) throw new ApiError("upstream_failed", "Research service returned invalid data");
      if (!Array.isArray(envelope.data)) throw new ApiError("upstream_failed", "Research service returned invalid data");
      values.push(...envelope.data as T[]);
      const total = envelope.meta?.total;
      if (typeof total !== "number" || values.length >= total || envelope.data.length === 0) return values;
    }
    throw new ApiError("upstream_failed", "Research service returned too many pages");
  }

  private async read(path: string, nullOn404 = false): Promise<unknown | null> {
    const envelope = await this.request(path, nullOn404);
    return envelope?.data ?? null;
  }

  private async request(path: string, nullOn404 = false): Promise<UpstreamEnvelope | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ApiError("upstream_failed", "Research service request failed");
    }
    if (nullOn404 && response.status === 404) return null;
    if (!response.ok) throw new ApiError("upstream_failed", `Research service returned ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("upstream_failed", "Research service returned invalid data");
    }
    if (!isEnvelope(body) || !body.ok) throw new ApiError("upstream_failed", `Research service returned ${response.status}`);
    return body;
  }
}

export class FakePart2Client implements Part2Client {
  private data: FakePart2Data;

  constructor(data: FakePart2Data) {
    this.data = structuredClone(data);
  }

  async getRun(runId: string): Promise<ResearchRunHead | null> {
    return structuredClone(this.data.run.runId === runId ? this.data.run : null);
  }

  async getCareerPaths(runId: string): Promise<CareerPath[]> {
    return structuredClone(this.data.run.runId === runId ? this.data.careerPaths : []);
  }

  async getMarket(runId: string): Promise<JobMarket[]> {
    return structuredClone(this.data.run.runId === runId ? this.data.market : []);
  }

  async getTrends(runId: string): Promise<OccupationTrends[]> {
    return structuredClone(this.data.run.runId === runId ? this.data.trends : []);
  }

  async getSeekerResearch(runId: string): Promise<SeekerResearch> {
    if (this.data.run.runId !== runId) throw new ApiError("upstream_failed", "Research service returned 404");
    return structuredClone(this.data.seekerResearch);
  }

  async listCompanies(runId: string): Promise<Company[]> {
    return structuredClone(this.data.run.runId === runId ? this.data.companies : []);
  }

  async listVacancies(runId: string, occupationUri: string): Promise<Vacancy[]> {
    if (this.data.run.runId !== runId) return [];
    return structuredClone(this.data.vacancies.filter((vacancy) => vacancy.occupation.uri === occupationUri));
  }
}

export function part2FromEnv(): Part2Client {
  return new HttpPart2Client();
}
