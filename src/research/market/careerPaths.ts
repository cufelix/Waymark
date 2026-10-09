// Top career paths: chosen and ordered only by market demand and the seeker's goal, never by skill fit.
import type { CareerPath, CareerPreferences, Claim, Occupation, Source } from "../../contracts";
import { query } from "../../db/pool";
import { newId, sha256 } from "../../ids";

export type PathVacancy = {
  occupationUri: string;
  companyId: string;
  isDream: boolean;
  skillUris: string[];
  url: string;
  title: string;
  location: string;
};

type Goal = CareerPreferences["goal"];

/** Pure ranking: vacancy count first, then a goal-specific tie-break. Returns at most 3 paths. */
export function rankCareerPaths(occupations: Occupation[], vacancies: PathVacancy[], goal: Goal, now = new Date()): CareerPath[] {
  const scored = occupations.map((occupation) => {
    const vs = vacancies.filter((v) => v.occupationUri === occupation.uri);
    const tieBreak =
      goal === "stability" ? new Set(vs.map((v) => v.companyId)).size
      : goal === "learn-fast" ? new Set(vs.flatMap((v) => v.skillUris)).size
      : vs.filter((v) => v.isDream).length;
    return { occupation, vs, tieBreak };
  });
  scored.sort((a, b) => b.vs.length - a.vs.length || b.tieBreak - a.tieBreak);
  // A path with no current vacancies isn't a path into work right now; it only stays if nothing has any.
  const open = scored.filter((s) => s.vs.length > 0);
  return (open.length ? open : scored).slice(0, 3).map(({ occupation, vs }) => ({
    occupation,
    vacancyCount: vs.length,
    why: vs.length ? [demandClaim(occupation, vs, now)] : [],
  }));
}

function demandClaim(occupation: Occupation, vs: PathVacancy[], now: Date): Claim {
  const places = [...new Set(vs.map((v) => v.location))].join(", ");
  const sources: Source[] = vs.slice(0, 5).map((v) => ({
    id: newId("src"), url: v.url, title: v.title, fetchedAt: now.toISOString(), tool: "official-api", contentHash: sha256(v.url),
  }));
  return {
    id: newId("clm"),
    subject: { kind: "vacancy", id: occupation.uri },
    statement: `${vs.length} vacancies for ${occupation.label} found in ${places}`,
    kind: "fact",
    tier: vs.length > 1 ? "corroborated" : "single-source",
    sources,
  };
}

type Row = { company_id: string; is_dream: boolean; data: { query?: { occupationUri: string; country: string; city: string | null }; sourceUrl?: string; title: string; requirements?: { skill: { uri: string } }[] } };

export async function careerPaths(runId: string, occupations: Occupation[], goal: Goal): Promise<CareerPath[]> {
  const rows = await query<Row>(
    `SELECT v.company_id, COALESCE(rc.is_dream, false) AS is_dream, v.data
     FROM run_vacancies rv JOIN vacancies v ON v.id = rv.vacancy_id
     LEFT JOIN run_companies rc ON rc.run_id = rv.run_id AND rc.company_id = v.company_id
     WHERE rv.run_id = $1`,
    [runId],
  );
  const vacancies: PathVacancy[] = rows
    .filter((r) => r.data.query)
    .map((r) => ({
      occupationUri: r.data.query!.occupationUri,
      companyId: r.company_id,
      isDream: r.is_dream,
      skillUris: (r.data.requirements ?? []).map((q) => q.skill.uri),
      url: r.data.sourceUrl ?? "",
      title: r.data.title,
      location: r.data.query!.city ?? r.data.query!.country,
    }));
  // ponytail: candidates are the seeker's target occupations only; add related ESCO occupations when fewer than 3 is common
  return rankCareerPaths(occupations, vacancies, goal);
}
