// Market research for one seeker: vacancies → requirements → companies → market → career paths.
import type { CareerPath, JobMarket, Occupation, OccupationTrends, ResearchOptions, RunStep, SeekerProfile } from "../../contracts";
import { searchOccupations } from "../../shared/taxonomy";
import { query } from "../../db/pool";
import { errorMessage, log } from "../../log";
import { careerPaths } from "./careerPaths";
import { enrichCompany, linkRunCompany, refreshGhostSignals, upsertCompany } from "./companies";
import { buildMarket } from "./market";
import { extractRequirements } from "./requirements";
import { skillTrends } from "./trends";
import { findVacancies, searchTerms } from "./vacancies";
import { ladders } from "./ladder";

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2));

/** Adds related ESCO occupations until there are 3 candidates, skipping ones that are the same job under another name. */
async function withRelated(targets: Occupation[], runId: string): Promise<Occupation[]> {
  if (targets.length >= 3) return targets;
  const out = [...targets];
  for (const t of targets) {
    try {
      const tw = words(t.label);
      for (const o of await searchOccupations(t.label, "en", 8)) {
        if (out.length >= 3) break;
        const ow = words(o.label);
        const shared = [...ow].filter((w) => tw.has(w)).length;
        // Same job: shares most of the target's words (e.g. "nurse responsible for general care" for "general care nurse").
        if (out.some((x) => x.uri === o.uri) || shared >= Math.min(tw.size, ow.size) * 0.6) continue;
        out.push(o);
      }
    } catch (err) {
      log.warn("related occupations failed", { runId, occupation: t.uri, error: errorMessage(err) });
    }
  }
  return out;
}

type Progress = (step: Exclude<RunStep, "seeker-research">, done: number, total: number) => void;

export async function researchMarket(
  profile: SeekerProfile,
  options: ResearchOptions,
  runId: string,
  onProgress: Progress = () => undefined,
  onCareerPaths: (paths: CareerPath[]) => Promise<void> = async () => undefined,
): Promise<{ careerPaths: CareerPath[]; trends: OccupationTrends[]; companyIds: string[]; vacancyIds: string[]; market: JobMarket[] }> {
  const { targetOccupations, locations, remote, dreamCompanies, goal } = profile.preferences;
  // Top 3 career paths: the seeker's targets, plus related occupations when there are fewer than 3 (API.md).
  const occupations = await withRelated(targetOccupations, runId);
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

  // Ads found for a junior seeker are mostly entry-level; look once more for the upper steps of each ladder.
  for (const { occupation, location } of pairs) {
    try {
      const term = (await searchTerms(occupation, location.country, runId))[0] ?? occupation.label;
      const upper = [`Senior ${term}`, `Lead ${term}`];
      for (const id of await findVacancies(occupation, location, remote, Math.max(5, Math.floor(perPair / 3)), runId, options.sources, upper)) vacancyIds.add(id);
    } catch (err) {
      log.warn("upper-level vacancy search failed", { runId, occupation: occupation.uri, error: errorMessage(err) });
    }
  }

  // 2. Top career paths with their ladders, published straight away so the seeker can choose while the rest runs.
  const ladderByOccupation = await ladders(runId, occupations);
  const withLadders = (paths: CareerPath[]): CareerPath[] =>
    paths.map((p) => ({ ...p, ...(ladderByOccupation.get(p.occupation.uri)?.length ? { ladder: ladderByOccupation.get(p.occupation.uri) } : {}) }));
  await onCareerPaths(withLadders(await careerPaths(runId, occupations, goal)));
  onProgress("career-paths", 1, 1);

  // 3. Requirements from each vacancy text, with verbatim quotes.
  await extractRequirements(runId, (done, total) => onProgress("market", done, total));

  // 4. Companies: dream companies plus everyone hiring, enriched up to maxCompanies.
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

  // 5. Market numbers and career paths, both from what is stored for this run.
  const market = await buildMarket(runId, occupations, locations);
  onProgress("market", 1, 1);
  // Recomputed at the end: the order can shift once requirements are known (learn-fast counts distinct skills).
  const paths = withLadders(await careerPaths(runId, occupations, goal));

  // 6. Then vs now, so older career paths are checked against today's market (needs Exa's date filters).
  const homeLocation = locations[0]?.country ?? "US";
  const trends = options.sources.includes("exa")
    ? await skillTrends(
        await Promise.all(occupations.map(async (o) => ({ occupation: o, term: (await searchTerms(o, homeLocation, runId))[0] ?? o.label }))),
        market,
        runId,
      )
    : [];

  const allCompanies = await query<{ company_id: string }>("SELECT company_id FROM run_companies WHERE run_id = $1", [runId]);
  return { careerPaths: paths, trends, companyIds: allCompanies.map((c) => c.company_id), vacancyIds: [...vacancyIds], market };
}
