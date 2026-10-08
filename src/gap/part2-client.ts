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
const UNEXPECTED_RESPONSE = "Research service returned an unexpected response";

function isEnvelope(value: unknown): value is UpstreamEnvelope {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean" && "data" in value;
}

function unexpected(): never {
  throw new ApiError("upstream_failed", UNEXPECTED_RESPONSE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isArrayOf(value: unknown, item: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(item);
}

function isOccupation(value: unknown): boolean {
  return isRecord(value) && isString(value.uri) && isString(value.label) && isString(value.lang);
}

const isSkill = isOccupation;

function isSource(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && isString(value.url)
    && isString(value.title)
    && isString(value.fetchedAt)
    && isString(value.tool)
    && isString(value.contentHash)
    && (value.quote === undefined || isString(value.quote))
    && (value.snapshotKey === undefined || isString(value.snapshotKey));
}

function isClaim(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && isRecord(value.subject)
    && isString(value.subject.kind)
    && isString(value.subject.id)
    && isString(value.statement)
    && (value.skill === undefined || isSkill(value.skill))
    && (value.kind === "fact" || value.kind === "inference")
    && ["verified", "corroborated", "single-source", "contradicted", "stated"].includes(String(value.tier))
    && isArrayOf(value.sources, isSource);
}

function isCareerStep(value: unknown): boolean {
  return isRecord(value)
    && ["entry", "junior", "mid", "senior", "lead", "executive"].includes(String(value.level))
    && isString(value.title)
    && isArrayOf(value.claims, isClaim);
}

function isCareerPath(value: unknown): boolean {
  return isRecord(value)
    && isOccupation(value.occupation)
    && isArrayOf(value.why, isClaim)
    && isNumber(value.vacancyCount)
    && (value.ladder === undefined || isArrayOf(value.ladder, isCareerStep));
}

function isLocation(value: unknown, remote = false): boolean {
  return isRecord(value)
    && isString(value.country)
    && (value.city === undefined || isString(value.city))
    && (!remote || typeof value.remote === "boolean");
}

function isSalaryRange(value: unknown): boolean {
  return isRecord(value)
    && isNumber(value.p25)
    && isNumber(value.median)
    && isNumber(value.p75)
    && isString(value.currency)
    && (value.period === "month" || value.period === "year")
    && isNumber(value.sampleSize);
}

function isMarket(value: unknown): boolean {
  return isRecord(value)
    && isOccupation(value.occupation)
    && isLocation(value.location)
    && isNumber(value.vacancyCount)
    && isArrayOf(value.skillDemand, (entry) => isRecord(entry)
      && isSkill(entry.skill)
      && isNumber(entry.vacanciesRequiring)
      && isNumber(entry.vacanciesTotal)
      && isArrayOf(entry.sources, isSource))
    && (value.salaryRange === undefined || isSalaryRange(value.salaryRange));
}

function isDateRange(value: unknown): boolean {
  return isRecord(value) && isString(value.from) && isString(value.to);
}

function isTrends(value: unknown): boolean {
  return isRecord(value)
    && isOccupation(value.occupation)
    && isDateRange(value.then)
    && isDateRange(value.now)
    && isNumber(value.thenDocs)
    && isNumber(value.nowDocs)
    && isArrayOf(value.skills, (entry) => isRecord(entry)
      && isSkill(entry.skill)
      && isNumber(entry.thenShare)
      && isNumber(entry.nowShare)
      && ["rising", "stable", "fading"].includes(String(entry.trend))
      && isArrayOf(entry.sources, isSource));
}

function isResearchLink(value: unknown): boolean {
  return isRecord(value)
    && isString(value.linkId)
    && isString(value.platform)
    && ["extracted", "partial", "unsupported", "failed"].includes(String(value.status))
    && (value.ownership === "confirmed" || value.ownership === "unconfirmed")
    && typeof value.reachable === "boolean"
    && isString(value.fetchedAt)
    && isArrayOf(value.provenSkills, isClaim);
}

function isSeekerResearch(value: unknown): boolean {
  return isRecord(value) && isArrayOf(value.links, isResearchLink);
}

function isCompany(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.country)
    && isArrayOf(value.registryIds, (entry) => isRecord(entry) && isString(entry.scheme) && isString(entry.id))
    && typeof value.isDreamCompany === "boolean"
    && isArrayOf(value.claims, isClaim)
    && isArrayOf(value.ghostSignals, isClaim);
}

function isVacancy(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && isString(value.companyId)
    && isString(value.canonicalUrl)
    && isString(value.title)
    && isString(value.lang)
    && isOccupation(value.occupation)
    && isLocation(value.location, true)
    && isArrayOf(value.requirements, (entry) => isRecord(entry)
      && isSkill(entry.skill)
      && typeof entry.required === "boolean"
      && isSource(entry.source))
    && (value.salary === undefined || (isRecord(value.salary)
      && (value.salary.min === undefined || isNumber(value.salary.min))
      && (value.salary.max === undefined || isNumber(value.salary.max))
      && isString(value.salary.currency)
      && (value.salary.period === "month" || value.salary.period === "year")
      && isSource(value.salary.source)))
    && (value.postedAt === undefined || isString(value.postedAt))
    && isString(value.firstSeenAt)
    && isString(value.lastSeenAt)
    && isNumber(value.repostCount);
}

function expectList<T>(value: unknown, item: (entry: unknown) => boolean): T[] {
  if (!isArrayOf(value, item)) unexpected();
  return value as T[];
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
    if (data === undefined) return null;
    if (
      !isRecord(data)
      || typeof data.runId !== "string"
      || data.runId !== runId
      || typeof data.seekerId !== "string"
      || typeof data.profileVersion !== "number"
      || !["queued", "running", "done", "failed", "cancelled"].includes(String(data.status))
    ) unexpected();
    return data as ResearchRunHead;
  }

  async getCareerPaths(runId: string): Promise<CareerPath[]> {
    return expectList<CareerPath>(await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/career-paths`), isCareerPath);
  }

  async getMarket(runId: string): Promise<JobMarket[]> {
    return expectList<JobMarket>(await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/market`), isMarket);
  }

  async getTrends(runId: string): Promise<OccupationTrends[]> {
    return expectList<OccupationTrends>(await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/trends`), isTrends);
  }

  async getSeekerResearch(runId: string): Promise<SeekerResearch> {
    const data = await this.read(`/v1/research-runs/${encodeURIComponent(runId)}/seeker-research`);
    if (!isSeekerResearch(data)) unexpected();
    return data as SeekerResearch;
  }

  async listCompanies(runId: string): Promise<Company[]> {
    return await this.readPages(`/v1/research-runs/${encodeURIComponent(runId)}/companies`, isCompany);
  }

  async listVacancies(runId: string, occupationUri: string): Promise<Vacancy[]> {
    const path = `/v1/research-runs/${encodeURIComponent(runId)}/vacancies?occupation=${encodeURIComponent(occupationUri)}`;
    return await this.readPages(path, isVacancy);
  }

  private async readPages<T>(path: string, item: (entry: unknown) => boolean): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const envelope = await this.request(`${path}${separator}page=${page}&pageSize=${PAGE_SIZE}`);
      if (!envelope || !isArrayOf(envelope.data, item)) unexpected();
      values.push(...envelope.data as T[]);
      const total = envelope.meta?.total;
      if (typeof total !== "number" || values.length >= total || envelope.data.length === 0) return values;
    }
    throw new ApiError("upstream_failed", "Research service returned too many pages");
  }

  private async read(path: string, nullOn404 = false): Promise<unknown | undefined> {
    const envelope = await this.request(path, nullOn404);
    return envelope === null ? undefined : envelope.data;
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
