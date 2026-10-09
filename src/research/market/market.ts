// Job market per occupation and location: vacancy counts, demand per skill, salary range.
import type { JobMarket, Occupation, Skill, Source } from "../../contracts";
import { query } from "../../db/pool";

export type MarketVacancy = {
  occupationUri: string;
  country: string;
  city: string | null;
  requirementsExtracted: boolean;
  requirements: { skill: Skill; source: Source }[];
  salary?: { min?: number; max?: number; currency: string; period: "month" | "year" };
};

export type Loc = { country: string; city?: string };

/** Linear-interpolation percentile of a sorted array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

/** p25 / median / p75 of the largest currency+period group, when it has at least 5 salaries. */
export function salaryRange(salaries: NonNullable<MarketVacancy["salary"]>[]): JobMarket["salaryRange"] {
  const groups = new Map<string, number[]>();
  for (const s of salaries) {
    const value = s.min && s.max ? (s.min + s.max) / 2 : (s.min ?? s.max);
    if (!value) continue;
    const key = `${s.currency}|${s.period}`;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  const [best] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!best || best[1].length < 5) return undefined;
  const [currency, period] = best[0].split("|") as [string, "month" | "year"];
  const sorted = [...best[1]].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n);
  return { p25: round(percentile(sorted, 0.25)), median: round(percentile(sorted, 0.5)), p75: round(percentile(sorted, 0.75)), currency, period, sampleSize: sorted.length };
}

const inLocation = (v: MarketVacancy, loc: Loc): boolean =>
  v.country === loc.country && (!loc.city || (v.city ?? "").toLowerCase() === loc.city.toLowerCase());

/** Builds one JobMarket per occupation × location from the vacancies found for them. */
export function computeMarket(vacancies: MarketVacancy[], occupations: Occupation[], locations: Loc[]): JobMarket[] {
  const out: JobMarket[] = [];
  for (const occupation of occupations) {
    for (const loc of locations) {
      const group = vacancies.filter((v) => v.occupationUri === occupation.uri && inLocation(v, loc));
      const withReqs = group.filter((v) => v.requirementsExtracted);
      const demand = new Map<string, { skill: Skill; count: number; sources: Source[] }>();
      for (const v of withReqs) {
        for (const r of v.requirements) {
          const d = demand.get(r.skill.uri) ?? { skill: r.skill, count: 0, sources: [] };
          d.count += 1;
          if (d.sources.length < 5) d.sources.push(r.source);
          demand.set(r.skill.uri, d);
        }
      }
      out.push({
        occupation,
        location: loc.city ? { country: loc.country, city: loc.city } : { country: loc.country },
        vacancyCount: group.length,
        skillDemand: [...demand.values()]
          .sort((a, b) => b.count - a.count)
          .map((d) => ({ skill: d.skill, vacanciesRequiring: d.count, vacanciesTotal: withReqs.length, sources: d.sources })),
        salaryRange: salaryRange(group.flatMap((v) => (v.salary ? [v.salary] : []))),
      });
    }
  }
  return out;
}

type Row = { data: { query?: { occupationUri: string; country: string; city: string | null }; requirementsExtracted?: boolean; requirements?: MarketVacancy["requirements"]; salary?: MarketVacancy["salary"] } };

export async function loadRunVacancies(runId: string): Promise<MarketVacancy[]> {
  const rows = await query<Row>("SELECT v.data FROM vacancies v JOIN run_vacancies rv ON rv.vacancy_id = v.id WHERE rv.run_id = $1 AND NOT rv.irrelevant", [runId]);
  return rows
    .filter((r) => r.data.query)
    .map((r) => ({
      occupationUri: r.data.query!.occupationUri,
      country: r.data.query!.country,
      city: r.data.query!.city,
      requirementsExtracted: r.data.requirementsExtracted ?? false,
      requirements: r.data.requirements ?? [],
      salary: r.data.salary,
    }));
}

export async function buildMarket(runId: string, occupations: Occupation[], locations: Loc[]): Promise<JobMarket[]> {
  return computeMarket(await loadRunVacancies(runId), occupations, locations);
}
