import { now } from "../seeker/core/claims.ts";
import { ApiError } from "../seeker/core/errors.ts";
import { newId } from "../seeker/core/ids.ts";
import { validateSeekerProfile } from "../seeker/core/validate.ts";
import { buildCompanyChecks } from "./companies.ts";
import type { CompanyCheck, JobProfile, MarketFacts, SkillCheck, Validation, ValidationRequest } from "./contracts.ts";
import { buildSkillChecks } from "./evidence.ts";
import { buildJobProfile } from "./job-profile.ts";
import { buildMarketFacts } from "./market.ts";
import type { Part2Client } from "./part2-client.ts";
import type { GapStore } from "./store.ts";

export type ValidationDeps = { store: GapStore; part2: Part2Client };

export const defaultBuilders = {
  buildJobProfile,
  buildSkillChecks,
  buildCompanyChecks,
  buildMarketFacts,
};

export type ValidationBuilders = {
  buildJobProfile: typeof buildJobProfile;
  buildSkillChecks: typeof buildSkillChecks;
  buildCompanyChecks: typeof buildCompanyChecks;
  buildMarketFacts: typeof buildMarketFacts;
};

function invalid(message: string): never {
  throw new ApiError("unprocessable", message);
}

function validateRequest(value: unknown): ValidationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Request body must be an object");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["profile", "runId", "occupationUri"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) invalid(`Unknown field: ${unknown}`);
  if (typeof body.runId !== "string" || !body.runId.startsWith("run_") || body.runId.length <= 4) invalid("runId must be a run_ prefixed string");
  if (body.occupationUri !== undefined && typeof body.occupationUri !== "string") invalid("occupationUri must be a string");
  try {
    const profile = validateSeekerProfile(body.profile, "profile");
    return {
      profile,
      runId: body.runId,
      ...(body.occupationUri === undefined ? {} : { occupationUri: body.occupationUri }),
    };
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError("unprocessable", error.message);
    throw error;
  }
}

function occupationUri(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const uri = (value as { uri?: unknown }).uri;
  return typeof uri === "string" ? uri : undefined;
}

export async function createValidation(
  deps: ValidationDeps,
  request: ValidationRequest,
  builders: ValidationBuilders = defaultBuilders,
): Promise<Validation> {
  const req = validateRequest(request);
  const profile = req.profile;
  if (profile.status !== "complete") invalid("profile.status must be complete");

  const run = await deps.part2.getRun(req.runId);
  if (!run) invalid(`Research run ${req.runId} does not exist`);
  if (run.seekerId !== profile.seekerId) invalid("Research run does not belong to profile.seekerId");
  if (run.status !== "done") throw new ApiError("conflict", `Research run ${req.runId} is not done`);

  const careerPaths = await deps.part2.getCareerPaths(req.runId);
  const requestedUri = req.occupationUri
    ?? occupationUri(profile.careerChoice?.occupation)
    ?? occupationUri(profile.preferences.targetOccupations[0]);
  if (!requestedUri) invalid("No occupation was selected");
  const careerPath = careerPaths.find((path) => path.occupation.uri === requestedUri);
  const target = profile.preferences.targetOccupations.find((candidate) => occupationUri(candidate) === requestedUri);
  const occupation = careerPath?.occupation ?? target;
  if (!occupation) invalid("Occupation is not in the run career paths or target occupations");

  const [marketData, trendsData, research, companies, vacancies] = await Promise.all([
    deps.part2.getMarket(req.runId),
    deps.part2.getTrends(req.runId),
    deps.part2.getSeekerResearch(req.runId),
    deps.part2.listCompanies(req.runId),
    deps.part2.listVacancies(req.runId, requestedUri),
  ]);
  const market = marketData.filter((entry) => entry.occupation.uri === requestedUri);
  const trends = trendsData.find((entry) => entry.occupation.uri === requestedUri);
  const locations = profile.preferences.locations;

  const jobProfile: JobProfile = builders.buildJobProfile({ occupation, vacancies, market, trends, careerPath });
  const skills: SkillCheck[] = builders.buildSkillChecks({ vacancies, companies, profile, research, trends });
  const companyChecks: CompanyCheck[] = builders.buildCompanyChecks({ vacancies, companies, profile, research });
  const marketFacts: MarketFacts[] = builders.buildMarketFacts({ vacancies, market, locations });

  const validation: Validation = {
    validationId: newId("val"),
    seekerId: profile.seekerId,
    runId: req.runId,
    profileVersion: profile.profileVersion,
    createdAt: now(),
    occupation,
    locations,
    jobProfile,
    skills,
    companies: companyChecks,
    market: marketFacts,
  };
  await deps.store.put(validation);
  return validation;
}

export async function getValidation(deps: Pick<ValidationDeps, "store">, validationId: string): Promise<Validation> {
  const validation = await deps.store.get(validationId);
  if (!validation) throw new ApiError("not_found", `Validation ${validationId} does not exist`);
  return validation;
}

export async function listValidations(deps: Pick<ValidationDeps, "store">, seekerId: string): Promise<Validation[]> {
  return deps.store.listBySeeker(seekerId);
}

export async function deleteValidations(deps: Pick<ValidationDeps, "store">, seekerId: string): Promise<{ deleted: true; validations: number }> {
  return { deleted: true, validations: await deps.store.deleteBySeeker(seekerId) };
}
