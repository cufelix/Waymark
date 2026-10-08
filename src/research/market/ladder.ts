// Career ladder per occupation, from today's job ads: which levels exist, what they're called, how much
// experience they ask for and what they pay. Only levels the ads show appear; nothing is estimated without a source.
import { z } from "zod";
import type { CareerStep, Claim, Occupation, Source } from "../../contracts";
import { query } from "../../db/pool";
import { newId } from "../../ids";
import { chatJson } from "../../llm";
import { errorMessage, log } from "../../log";
import { percentile } from "./market";
import { countryName, quoteInText } from "./normalise";
import { toolRegistry } from "../../tools";
import { runTool } from "../../tools/types";

export const LEVELS: CareerStep["level"][] = ["entry", "junior", "mid", "senior", "lead", "executive"];

export type LadderVacancy = {
  id: string;
  title: string;
  url: string;
  description: string;
  salary?: { min?: number; max?: number; currency: string; period: "month" | "year" };
  country: string;
  city?: string;
};

export type Classified = { level: CareerStep["level"]; minYears?: number; relevant?: boolean };

const Levels = z.object({
  jobs: z.array(z.object({ i: z.coerce.number(), relevant: z.boolean().optional(), level: z.enum(["entry", "junior", "mid", "senior", "lead", "executive"]), minYears: z.coerce.number().nullable().optional() })),
});

/** Seniority of each ad, from its title and the start of its text, in any language. */
async function classify(vacancies: LadderVacancy[], occupation: Occupation, runId: string): Promise<Map<string, Classified>> {
  const out = new Map<string, Classified>();
  for (let start = 0; start < vacancies.length; start += 15) {
    const batch = vacancies.slice(start, start + 15);
    try {
      const { value } = await chatJson(
        Levels,
        "You classify job ads by seniority level, in any language and any profession.",
        `Levels: entry (trainee, intern, apprentice, no experience), junior, mid, senior, lead (team lead, head of, principal, manager of a team), executive (director, chief, VP). ` +
          `For each ad give its level, the minimum years of experience it asks for (null if it doesn't say), ` +
          `and relevant: whether the ad is really for the occupation "${occupation.label}" (false for unrelated jobs a search returned). ` +
          `Return {"jobs":[{"i":0,"relevant":true,"level":"junior","minYears":1}]}.\n\n` +
          batch.map((v, i) => `${i}. ${v.title}\n${v.description.slice(0, 400)}`).join("\n\n"),
        { runId, maxTokens: 1500 },
      );
      for (const j of value.jobs) {
        const v = batch[j.i];
        if (v) out.set(v.id, { level: j.level, minYears: j.minYears ?? undefined, relevant: j.relevant ?? true });
      }
    } catch (err) {
      log.warn("seniority classification failed", { runId, error: errorMessage(err) });
    }
  }
  return out;
}

/** Pure: builds the ladder from classified ads. Salary only when at least 3 ads at that level state one in the same currency and period. */
export function buildLadder(vacancies: LadderVacancy[], levels: Map<string, Classified>, now = new Date()): CareerStep[] {
  const steps: CareerStep[] = [];
  for (const level of LEVELS) {
    const vs = vacancies.filter((v) => levels.get(v.id)?.level === level && levels.get(v.id)?.relevant !== false);
    if (vs.length === 0) continue;
    const sources: Source[] = vs.slice(0, 5).map((v) => ({
      id: newId("src"), url: v.url, title: v.title, fetchedAt: now.toISOString(), tool: "official-api", contentHash: v.id,
    }));
    const years = vs.map((v) => levels.get(v.id)?.minYears).filter((y): y is number => typeof y === "number" && y >= 0).sort((a, b) => a - b);
    const salary = salaryFor(vs);
    const claims: Claim[] = [
      {
        id: newId("clm"), subject: { kind: "vacancy", id: level }, kind: "inference", tier: vs.length > 1 ? "corroborated" : "single-source",
        statement: `${vs.length} current ads are at ${level} level`, sources,
      },
    ];
    if (salary) {
      claims.push({
        id: newId("clm"), subject: { kind: "vacancy", id: level }, kind: "fact", tier: "corroborated",
        statement: `Median advertised pay at ${level} level: ${salary.median} ${salary.currency} per ${salary.period} (${salary.sampleSize} ads)`,
        sources: sources.filter((s) => vs.find((v) => v.url === s.url)?.salary),
      });
    }
    steps.push({
      level,
      title: mostCommonTitle(vs.map((v) => v.title)),
      ...(years.length ? { typicalExperienceYears: { min: years[0]!, max: years.at(-1)! > years[0]! ? years.at(-1)! : undefined } } : {}),
      ...(salary ? { salary } : {}),
      claims: claims.filter((c) => c.sources.length > 0),
    });
  }
  return steps;
}

function salaryFor(vs: LadderVacancy[]): CareerStep["salary"] | undefined {
  const groups = new Map<string, { mid: number[]; v: LadderVacancy }>();
  for (const v of vs) {
    if (!v.salary) continue;
    const mid = v.salary.min && v.salary.max ? (v.salary.min + v.salary.max) / 2 : (v.salary.min ?? v.salary.max);
    if (!mid) continue;
    const key = `${v.salary.currency}|${v.salary.period}`;
    const g = groups.get(key) ?? { mid: [], v };
    g.mid.push(mid);
    groups.set(key, g);
  }
  const best = [...groups.values()].sort((a, b) => b.mid.length - a.mid.length)[0];
  if (!best || best.mid.length < 3) return undefined;
  const sorted = best.mid.sort((a, b) => a - b);
  return {
    p25: Math.round(percentile(sorted, 0.25)), median: Math.round(percentile(sorted, 0.5)), p75: Math.round(percentile(sorted, 0.75)),
    currency: best.v.salary!.currency, period: best.v.salary!.period, sampleSize: sorted.length,
    location: { country: best.v.country, ...(best.v.city ? { city: best.v.city } : {}) },
  };
}

/** The title most ads at this level use, ignoring case and gender suffixes like (m/w/d). */
function mostCommonTitle(titles: string[]): string {
  const clean = (t: string) => t.replace(/\((m|w|f|d|x|all)([/|,]\s*(m|w|f|d|x))*\)/gi, "").replace(/\s+/g, " ").trim();
  const counts = new Map<string, { n: number; title: string }>();
  for (const t of titles.map(clean)) {
    const k = t.toLowerCase();
    counts.set(k, { n: (counts.get(k)?.n ?? 0) + 1, title: counts.get(k)?.title ?? t });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.title ?? titles[0] ?? "";
}

type Row = { id: string; data: { title: string; sourceUrl?: string; description?: string; salary?: LadderVacancy["salary"]; query?: { occupationUri: string; country: string; city: string | null } } };

const loose = z.union([z.number(), z.string()]).nullable().optional();
const SalaryFound = z.object({ found: z.boolean(), median: loose, low: loose, high: loose, p25: loose, p75: loose, currency: z.string().nullable().optional(), period: z.string().nullable().optional(), quote: z.string().nullable().optional() });

/** "65 000 Kč", "65,000", 65000 → 65000; anything else → undefined. */
export const amount = (v: unknown): number | undefined => {
  if (typeof v === "number") return v > 0 ? v : undefined;
  if (typeof v !== "string") return undefined;
  const n = Number(v.replace(/[^\d.,]/g, "").replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const periodOf = (p: unknown): "month" | "year" | undefined =>
  typeof p === "string" ? (/year|annual|roč|jahr|\ban\b|compensation|p\.a\./i.test(p) ? "year" : /month|měs|monat|mois/i.test(p) ? "month" : undefined) : undefined;

/**
 * Pay for one step from salary sites published in the last 12 months, when the ads gave none.
 * A figure counts only with a verbatim quote from the page; otherwise the step keeps no salary.
 */
export async function salaryFromSites(step: CareerStep, country: string, city: string | undefined, runId: string): Promise<CareerStep> {
  const exa = toolRegistry.get("exa_search");
  if (!exa?.available()) return step;
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const query = `${step.title} salary ${city ?? countryName(country)}`;
  // Recent pages first; many salary pages carry no publication date, so fall back to an undated search.
  let res = await runTool(exa, { query, numResults: 3, startPublishedDate: since }, { runId });
  if (!res.ok || !Array.isArray(res.raw) || res.raw.length === 0) res = await runTool(exa, { query, numResults: 3 }, { runId });
  const pages = res.ok && Array.isArray(res.raw) ? (res.raw as { url: string; title?: string; text?: string }[]).filter((p) => p.text) : [];
  for (const page of pages) {
    try {
      const { value } = await chatJson(
        SalaryFound,
        "You read salary pages and report the pay they state. Never estimate; report only figures the page gives.",
        `Job: "${step.title}" in ${city ?? countryName(country)}. Does this page state the pay for this job there? ` +
          `If yes, give median (the single typical or average figure, if the page gives one), low and high (if it gives a range), currency (ISO code), ` +
          `period (month or year), and an exact quote (copied character for character) containing the figures. ` +
          `If not, {"found": false}.\n\n${page.text!.slice(0, 3000)}`,
        { runId, maxTokens: 800 },
      );
      const low = amount(value.low);
      const high = amount(value.high);
      // A stated median wins; a stated range gives its midpoint. Nothing is invented beyond what the quote says.
      const median = amount(value.median) ?? (low && high ? Math.round((low + high) / 2) : undefined);
      const period = periodOf(value.period) ?? periodOf(value.quote);
      if (!value.found || !median || !value.currency || !period || !value.quote || !quoteInText(value.quote, page.text!)) continue;
      // Only quartiles the page states; a range's ends are not quartiles (it may cover 80% of earners), so they stay in the claim text.
      const p25 = amount(value.p25);
      const p75 = amount(value.p75);
      const source: Source = { id: newId("src"), url: page.url, title: page.title ?? page.url, fetchedAt: new Date().toISOString(), tool: "exa", quote: value.quote, contentHash: page.url };
      return {
        ...step,
        salary: {
          ...(p25 ? { p25 } : {}), median, ...(p75 ? { p75 } : {}),
          currency: value.currency.toUpperCase().slice(0, 3), period, sampleSize: 1, location: { country, ...(city ? { city } : {}) },
        },
        claims: [...step.claims, {
          id: newId("clm"), subject: { kind: "vacancy", id: step.level }, kind: "fact", tier: "single-source",
          statement: low && high && !amount(value.median)
            ? `A salary site reports a range of ${low}–${high} ${value.currency} per ${period} for ${step.title}`
            : `A salary site reports ${median} ${value.currency} per ${period} for ${step.title}`,
          sources: [source],
        }],
      };
    } catch (err) {
      log.warn("salary lookup failed", { runId, title: step.title, error: errorMessage(err) });
    }
  }
  return step;
}

/** Ladders for every occupation of a run, keyed by occupation URI. */
export async function ladders(runId: string, occupations: Occupation[]): Promise<Map<string, CareerStep[]>> {
  const rows = await query<Row>("SELECT v.id, v.data FROM run_vacancies rv JOIN vacancies v ON v.id = rv.vacancy_id WHERE rv.run_id = $1", [runId]);
  const out = new Map<string, CareerStep[]>();
  for (const occupation of occupations) {
    const vs: LadderVacancy[] = rows
      .filter((r) => r.data.query?.occupationUri === occupation.uri)
      .map((r) => ({
        id: r.id, title: r.data.title, url: r.data.sourceUrl ?? "", description: r.data.description ?? "",
        salary: r.data.salary, country: r.data.query!.country, city: r.data.query!.city ?? undefined,
      }));
    if (vs.length === 0) continue;
    const ladder = buildLadder(vs, await classify(vs, occupation, runId));
    const { country, city } = vs[0]!;
    out.set(occupation.uri, await Promise.all(ladder.map((step) => (step.salary ? step : salaryFromSites(step, country, city, runId)))));
  }
  return out;
}
