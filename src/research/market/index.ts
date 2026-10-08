// Market research for one seeker: vacancies → requirements → companies → market → career paths.
import type { CareerPath, JobMarket, ResearchOptions, RunStep, SeekerProfile } from "../../contracts";
import { query } from "../../db/pool";
import { errorMessage, log } from "../../log";
import { careerPaths } from "./careerPaths";
import { enrichCompany, linkRunCompany, refreshGhostSignals, upsertCompany } from "./companies";
import { buildMarket } from "./market";
import { extractRequirements } from "./requirements";
import { findVacancies } from "./vacancies";

type Progress = (step: Exclude<RunStep, "seeker-research">, done: number, total: number) => void;

export async function researchMarket(
  profile: SeekerProfile,
  options: ResearchOptions,
  runId: string,
  onProgress: Progress = () => undefined,
): Promise<{ careerPaths: CareerPath[]; companyIds: string[]; vacancyIds: string[]; market: JobMarket[] }> {
  const { targetOccupations: occupations, locations, remote, dreamCompanies, goal } = profile.preferences;
  const pairs = occupations.flatMap((occupation) => locations.map((location) => ({ occupation, location })));
  const perPair = Math.max(1, Math.floor(options.maxVacancies / Math.max(1, pairs.length)));

  // 1. Vacancies, one occupation × location at a time; one failing pair doesn't stop the others.
  const vacancyIds = new Set<string>();
  for (const [i, { occupation, location }] of pairs.entries()) {
    onProgress("vacancies", i, pairs.length);
    try {
      for (const id of await findVacancies(occupation, location, remote, perPair, runId, options.sources)) vacancyIds.add(id);
    } catch (err) {
      log.warn("vacancy search failed", { runId, occupation: occupation.uri, country: location.country, error: errorMessage(err) });
    }
  }
  onProgress("vacancies", pairs.length, pairs.length);

  // 2. Requirements from each vacancy text, with verbatim quotes.
  await extractRequirements(runId, (done, total) => onProgress("market", done, total));

  // 3. Companies: dream companies plus everyone hiring, enriched up to maxCompanies.
  const homeCountry = locations[0]?.country ?? "ZZ";
  for (const dream of dreamCompanies) await linkRunCompany(runId, await upsertCompany(dream.name, homeCountry), true);
  const companies = await query<{ company_id: string }>(
    "SELECT company_id FROM run_companies WHERE run_id = $1 ORDER BY is_dream DESC LIMIT $2",
    [runId, options.maxCompanies],
  );
  for (const [i, { company_id }] of companies.entries()) {
    onProgress("companies", i, companies.length);
    try {
      await enrichCompany(company_id, options, runId);
      await refreshGhostSignals(company_id);
    } catch (err) {
      log.warn("company enrichment failed", { runId, companyId: company_id, error: errorMessage(err) });
    }
  }
  onProgress("companies", companies.length, companies.length);

  // 4. Market numbers and 5. career paths, both from what is stored for this run.
  const market = await buildMarket(runId, occupations, locations);
  onProgress("market", 1, 1);
  const paths = await careerPaths(runId, occupations, goal);
  onProgress("career-paths", 1, 1);

  const allCompanies = await query<{ company_id: string }>("SELECT company_id FROM run_companies WHERE run_id = $1", [runId]);
  return { careerPaths: paths, companyIds: allCompanies.map((c) => c.company_id), vacancyIds: [...vacancyIds], market };
}
