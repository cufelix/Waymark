import type { Validation } from "./contracts.ts";
import { ApiError } from "../seeker/core/errors.ts";

export interface ValidationReader {
  getValidation(validationId: string): Promise<Validation>;
}

type HttpValidationReaderOptions = { baseUrl?: string; apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch };

type UpstreamEnvelope = { ok: boolean; data: unknown };

const UNEXPECTED = "Validation service returned an unexpected response";
const ULID = "[0-9A-HJKMNP-TV-Z]{26}";

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

function hasIdPrefix(value: unknown, prefix: "val" | "skr" | "run" | "clm" | "src"): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_${ULID}$`).test(value);
}

function isSource(value: unknown): boolean {
  return isRecord(value)
    && hasIdPrefix(value.id, "src")
    && isString(value.url)
    && isString(value.title)
    && isString(value.fetchedAt)
    && ["apify", "firecrawl", "exa", "registry", "seeker-upload", "seeker-link", "seeker-interview"].includes(String(value.tool))
    && isString(value.contentHash)
    && (value.quote === undefined || isString(value.quote))
    && (value.snapshotKey === undefined || isString(value.snapshotKey));
}

function isOccupation(value: unknown): boolean {
  return isRecord(value) && isString(value.uri) && isString(value.label) && isString(value.lang);
}

const isSkill = isOccupation;

function isClaim(value: unknown): boolean {
  return isRecord(value)
    && hasIdPrefix(value.id, "clm")
    && isRecord(value.subject)
    && isString(value.subject.kind)
    && isString(value.subject.id)
    && isString(value.statement)
    && (value.skill === undefined || isSkill(value.skill))
    && (value.kind === "fact" || value.kind === "inference")
    && ["verified", "corroborated", "single-source", "contradicted", "stated"].includes(String(value.tier))
    && Array.isArray(value.sources)
    && value.sources.length > 0
    && value.sources.every(isSource)
    && (value.validUntil === undefined || isString(value.validUntil));
}

function isLocation(value: unknown): boolean {
  return isRecord(value)
    && isString(value.country)
    && (value.city === undefined || isString(value.city));
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

function isCareerStep(value: unknown): boolean {
  return isRecord(value)
    && ["entry", "junior", "mid", "senior", "lead", "executive"].includes(String(value.level))
    && isString(value.title)
    && (value.occupation === undefined || isOccupation(value.occupation))
    && (value.typicalExperienceYears === undefined || (isRecord(value.typicalExperienceYears)
      && isNumber(value.typicalExperienceYears.min)
      && (value.typicalExperienceYears.max === undefined || isNumber(value.typicalExperienceYears.max))))
    && (value.salary === undefined || (isRecord(value.salary)
      && (value.salary.p25 === undefined || isNumber(value.salary.p25))
      && isNumber(value.salary.median)
      && (value.salary.p75 === undefined || isNumber(value.salary.p75))
      && isString(value.salary.currency)
      && (value.salary.period === "month" || value.salary.period === "year")
      && isNumber(value.salary.sampleSize)
      && isLocation(value.salary.location)))
    && isArrayOf(value.claims, isClaim);
}

function isJobSkill(value: unknown): boolean {
  return isRecord(value)
    && isSkill(value.skill)
    && isNumber(value.vacanciesRequiring)
    && isNumber(value.vacanciesTotal)
    && ["most", "many", "some"].includes(String(value.band))
    && (value.trend === undefined || ["rising", "stable", "fading"].includes(String(value.trend)))
    && (value.trendSources === undefined || isArrayOf(value.trendSources, isSource))
    && isArrayOf(value.sources, isSource);
}

function isSkillCheck(value: unknown): boolean {
  return isRecord(value)
    && isSkill(value.skill)
    && isRecord(value.demand)
    && isNumber(value.demand.vacanciesRequiring)
    && isNumber(value.demand.vacanciesTotal)
    && isNumber(value.demand.companiesRequiring)
    && isNumber(value.demand.companiesTotal)
    && isNumber(value.demand.requiredIn)
    && isArrayOf(value.demand.sources, isSource)
    && ["proven", "stated", "none"].includes(String(value.evidence))
    && isArrayOf(value.claims, isClaim)
    && (value.trend === undefined || ["rising", "stable", "fading"].includes(String(value.trend)))
    && (value.trendSources === undefined || isArrayOf(value.trendSources, isSource));
}

function isCompanyCheck(value: unknown): boolean {
  return isRecord(value)
    && isString(value.companyId)
    && isString(value.name)
    && typeof value.isDreamCompany === "boolean"
    && isArrayOf(value.vacancyIds, isString)
    && isArrayOf(value.requirements, (requirement) => isRecord(requirement)
      && isSkill(requirement.skill)
      && typeof requirement.required === "boolean"
      && ["proven", "stated", "none"].includes(String(requirement.evidence))
      && isSource(requirement.source));
}

function isMarketFacts(value: unknown): boolean {
  return isRecord(value)
    && isLocation(value.location)
    && isNumber(value.openVacancies)
    && isNumber(value.entryLevelVacancies)
    && isArrayOf(value.entryLevelSources, isSource)
    && (value.medianDaysOpen === undefined || isNumber(value.medianDaysOpen))
    && isNumber(value.repostedVacancies)
    && (value.salaryRange === undefined || isSalaryRange(value.salaryRange));
}

function isJobProfile(value: unknown): boolean {
  return isRecord(value)
    && isOccupation(value.occupation)
    && isNumber(value.vacanciesAnalysed)
    && isArrayOf(value.markets, (market) => isRecord(market)
      && isString(market.country)
      && (market.city === undefined || isString(market.city))
      && isNumber(market.vacancies))
    && isArrayOf(value.skills, isJobSkill)
    && (value.salaryRange === undefined || isSalaryRange(value.salaryRange))
    && (value.ladder === undefined || isArrayOf(value.ladder, isCareerStep))
    && (value.summary === undefined || isClaim(value.summary));
}

function isValidation(value: unknown, validationId: string): value is Validation {
  return isRecord(value)
    && value.validationId === validationId
    && hasIdPrefix(value.validationId, "val")
    && hasIdPrefix(value.seekerId, "skr")
    && hasIdPrefix(value.runId, "run")
    && isNumber(value.profileVersion)
    && isString(value.createdAt)
    && isOccupation(value.occupation)
    && isArrayOf(value.locations, isLocation)
    && isJobProfile(value.jobProfile)
    && isArrayOf(value.skills, isSkillCheck)
    && isArrayOf(value.companies, isCompanyCheck)
    && isArrayOf(value.market, isMarketFacts);
}

function isEnvelope(value: unknown): value is UpstreamEnvelope {
  return isRecord(value) && typeof value.ok === "boolean" && "data" in value;
}

/** Reads a validation from the Part 3 HTTP API. */
export class HttpValidationReader implements ValidationReader {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;

  constructor(options: HttpValidationReaderOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env.PART3_BASE_URL ?? process.env.PART2_BASE_URL;
    const apiKey = options.apiKey ?? process.env.PART3_API_KEY ?? process.env.PART2_API_KEY;
    if (!baseUrl) throw new ApiError("internal", "PART3_BASE_URL or PART2_BASE_URL is not set");
    if (!apiKey) throw new ApiError("internal", "PART3_API_KEY or PART2_API_KEY is not set");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getValidation(validationId: string): Promise<Validation> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/validations/${encodeURIComponent(validationId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ApiError("upstream_failed", "Validation service request failed");
    }

    if (response.status === 404) throw new ApiError("not_found", "Validation not found");
    if (!response.ok) throw new ApiError("upstream_failed", `Validation service returned ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("upstream_failed", UNEXPECTED);
    }
    if (!isEnvelope(body) || !body.ok || !isValidation(body.data, validationId)) {
      throw new ApiError("upstream_failed", UNEXPECTED);
    }
    return body.data;
  }
}

export class FakeValidationReader implements ValidationReader {
  private validations: Map<string, Validation>;

  constructor(validations: Validation[]) {
    this.validations = new Map(validations.map((validation) => [validation.validationId, structuredClone(validation)]));
  }

  async getValidation(validationId: string): Promise<Validation> {
    const validation = this.validations.get(validationId);
    if (!validation) throw new ApiError("not_found", "Validation not found");
    return structuredClone(validation);
  }
}

/** Builds the Part 3 reader from environment configuration when available. */
export function validationReaderFromEnv(): ValidationReader {
  return new HttpValidationReader();
}
