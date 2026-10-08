// Vacancy listing: an agent finds a job-board source for a country once, then the recipe is replayed.
import { countryLanguage, occupationLabels } from "../../shared/taxonomy";
import { z } from "zod";
import { config } from "../../config";
import type { Occupation, Source } from "../../contracts";
import { query } from "../../db/pool";
import { newId, sha256 } from "../../ids";
import { chatJson } from "../../llm";
import { log } from "../../log";
import { saveSnapshot } from "../../storage/snapshots";
import { runAgent } from "../../agent/loop";
import { getRecipe, replay, saveRecipe, setOutputMap, shapeOf, stepsFromCalls, type Recipe, type Vars } from "../../agent/recipes";
import { marketTools, toolRegistry } from "../../tools";
import { runTool } from "../../tools/types";
import { canonicalUrl, countryName, getPath } from "./normalise";
import { upsertCompany } from "./companies";

export const OUTPUT_FIELDS = [
  "title", "company", "url", "description", "location",
  "salaryMin", "salaryMax", "currency", "salaryPeriod", "postedAt", "remote",
] as const;

export type RawJob = {
  title: string;
  company: string;
  url: string;
  description: string;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  salaryPeriod?: "month" | "year";
  postedAt?: string;
  remote?: boolean;
};

export type Location = { country: string; city?: string };

const str = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ") || undefined;
  return undefined;
};
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const period = (v: unknown): "month" | "year" | undefined => {
  const s = str(v)?.toLowerCase() ?? "";
  if (/year|annual|yr|p\.a\./.test(s)) return "year";
  if (/month|mon|mo\b/.test(s)) return "month";
  return undefined;
};

/** Applies a learned output map to one raw item. Items without title, company or url are dropped. */
export function applyOutputMap(item: unknown, map: Record<string, string>): RawJob | null {
  const at = (f: string): unknown => (map[f] ? getPath(item, map[f]) : undefined);
  const title = str(at("title"));
  const company = str(at("company"));
  const url = str(at("url"));
  if (!title || !company || !url || !/^https?:\/\//.test(url)) return null;
  const remoteRaw = at("remote");
  return {
    title,
    company,
    url,
    description: str(at("description")) ?? "",
    location: str(at("location")),
    salaryMin: num(at("salaryMin")),
    salaryMax: num(at("salaryMax")),
    currency: str(at("currency"))?.toUpperCase().slice(0, 3),
    salaryPeriod: period(at("salaryPeriod")),
    postedAt: str(at("postedAt")),
    remote: typeof remoteRaw === "boolean" ? remoteRaw : /remote/i.test(str(remoteRaw) ?? ""),
  };
}

const OutputMap = z.record(z.string(), z.string());

async function learnOutputMap(sample: unknown[], runId: string): Promise<Record<string, string>> {
  const { value } = await chatJson(
    OutputMap,
    "You map fields of job-listing records to a target schema. Use dot paths into the record (for example \"company.name\" or \"salary.min\"). Omit a target field when the record has nothing for it.",
    `Target fields: ${OUTPUT_FIELDS.join(", ")}.\nRecords:\n${JSON.stringify(sample).slice(0, 8000)}\nReturn {"<target field>": "<dot path>"} for the fields that exist.`,
    { runId },
  );
  return Object.fromEntries(Object.entries(value).filter(([k]) => (OUTPUT_FIELDS as readonly string[]).includes(k)));
}

const Finish = z.object({
  usedCalls: z.array(z.number().int().nonnegative()).min(1),
  status: z.enum(["extracted", "partial", "unsupported"]),
  reason: z.string().optional(),
});

async function explore(key: string, vars: Vars, max: number, runId: string): Promise<{ items: unknown[]; recipe: Recipe } | null> {
  const run = await runAgent({
    system:
      "You find current job vacancies for a research tool. Use only public data. Prefer Apify actors with many users that return the full job description, " +
      "the company name and the job URL. Always run actors with a small maxItems first (10). Never use actors that need a login or cookies.",
    task:
      `Find job vacancies for "${vars.query}" in ${vars.location} (${vars.country}). ` +
      `Search the Apify store (for example "indeed jobs", "linkedin jobs", "${vars.location} jobs", "${vars.country} jobs"), pick the best actor, run it, ` +
      "and check the items contain title, company, URL and description. Then call finish with usedCalls = the indexes of the calls whose output holds the job items " +
      "(the actor run call last), status, and a short reason.",
    tools: marketTools,
    finish: {
      description: "Report which calls produced the job items.",
      parameters: {
        type: "object",
        properties: {
          usedCalls: { type: "array", items: { type: "integer" } },
          status: { type: "string", enum: ["extracted", "partial", "unsupported"] },
          reason: { type: "string" },
        },
        required: ["usedCalls", "status"],
      },
      parse: (a) => Finish.parse(a),
    },
    maxSteps: 10,
    maxUsd: 0.15,
    model: config.LLM_AGENT_MODEL,
    runId,
  });
  const done = run.finished;
  if (!done || done.status === "unsupported") {
    log.warn("vacancy agent found nothing", { key, stopReason: run.stopReason, reason: done?.reason });
    return null;
  }
  const last = run.calls[done.usedCalls.at(-1) ?? -1];
  if (!last?.result.ok || !Array.isArray(last.result.raw) || last.result.raw.length === 0) return null;
  const steps = stepsFromCalls(run.calls, done.usedCalls, vars);
  const expectedShape = shapeOf(last.result.raw);
  await saveRecipe({ key, steps, expectedShape, usdPerRun: run.usd });
  return {
    items: last.result.raw,
    recipe: { key, steps, outputMap: {}, expectedShape, runs: 1, successes: 1, usdPerRun: run.usd, status: "learned" },
  };
}

/** Sets maxItems on actor-run steps, so a recipe learned with 10 items can fetch as many as needed. */
// Size fields actors commonly use; the agent learns recipes with a small test size, replays use the real one.
const LIMIT_KEYS = ["limit", "maxItems", "maxResults", "max_items", "maxRows", "rows", "count", "resultsLimit", "maxJobs"];

const withMax = (recipe: Recipe, max: number): Recipe => ({
  ...recipe,
  steps: recipe.steps.map((s) => {
    if (s.tool !== "apify_run_actor") return s;
    const input = { ...((s.params.input as Record<string, unknown>) ?? {}) };
    for (const k of LIMIT_KEYS) if (typeof input[k] === "number") input[k] = max;
    return { ...s, params: { ...s.params, input, maxItems: max } };
  }),
});

const IDENTITY_MAP: Record<string, string> = Object.fromEntries(OUTPUT_FIELDS.map((f) => [f, f]));
const FREE_ENOUGH = 20;

/** Free, keyless job APIs first. Their items already use our field names. */
async function freeJobs(queries: string[], location: Location, remote: "only" | "ok" | "no", max: number, runId: string): Promise<unknown[]> {
  const tool = toolRegistry.get("free_jobs_search");
  if (!tool) return [];
  // One search per name the job goes by (English and local); the source listings are cached, so this is cheap.
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const query of queries) {
    const res = await runTool(tool, { query, country: location.country, remote: remote !== "no", limit: max }, { runId });
    for (const job of res.ok && Array.isArray(res.raw) ? res.raw : []) {
      const url = (job as { url?: string }).url ?? "";
      if (!seen.has(url) && out.length < max) seen.add(url) && out.push(job);
    }
  }
  return out;
}

const AdTitles = z.object({ titles: z.array(z.string()) });
const titleCache = new Map<string, string[]>();

/**
 * Search terms for an occupation in a country, for any job: the short titles employers there actually put
 * in job ads (in the local language), suggested by the fast model from the ESCO names, then the English label.
 * ESCO names alone are formal register titles ("Krankenpfleger Allgemeine Krankenpflege") that ads rarely use.
 */
export async function searchTerms(occupation: Occupation, country: string, runId?: string): Promise<string[]> {
  const key = `${occupation.uri}|${country}`;
  const hit = titleCache.get(key);
  if (hit) return hit;
  const lang = countryLanguage(country);
  const esco = lang === "en" ? [] : await occupationLabels(occupation.uri, lang);
  let titles: string[] = [];
  try {
    const { value } = await chatJson(
      AdTitles,
      "You know how jobs are advertised on job boards in every country and profession.",
      `Occupation: "${occupation.label}" (ESCO). Official names in ${lang}: ${JSON.stringify(esco)}.\n` +
        `Country: ${country}. Give the 2 to 4 short job titles employers in this country most often use in job ads for this occupation, ` +
        `in the language job ads there are written in (${lang}), most common first. Short search terms only, no seniority words. ` +
        `Return {"titles": [...]}.`,
      { runId, maxTokens: 200 },
    );
    titles = value.titles.map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 60).slice(0, 4);
  } catch (err) {
    log.warn("ad title suggestion failed", { occupation: occupation.uri, country, error: String(err) });
  }
  const terms = [...new Set([...titles, ...esco, occupation.label].map((t) => t.trim()).filter(Boolean))].slice(0, 6);
  if (titleCache.size > 5000) titleCache.clear();
  titleCache.set(key, terms);
  return terms;
}

/** Items from the learned Apify recipe for this country, exploring with the agent when there is none. */
async function apifyJobs(location: Location, vars: Vars, max: number, runId: string): Promise<{ items: unknown[]; map: Record<string, string> }> {
  const key = `vacancies:${location.country}`;
  let items: unknown[] | null = null;
  let recipe = await getRecipe(key);
  if (recipe) {
    const results = await replay(withMax(recipe, max), vars, toolRegistry, runId);
    const raw = results?.at(-1)?.raw;
    if (Array.isArray(raw)) items = raw;
  }
  if (!items) {
    const explored = await explore(key, vars, max, runId);
    if (!explored) return { items: [], map: {} };
    ({ items, recipe } = explored);
    // The agent explored with a small test size; fetch the full amount once with the recipe it just learned.
    if (recipe && items.length < max) {
      const full = (await replay(withMax(recipe, max), vars, toolRegistry, runId))?.at(-1)?.raw;
      if (Array.isArray(full) && full.length > items.length) items = full;
    }
  }
  if (!recipe) return { items: [], map: {} };
  let map = recipe.outputMap;
  if (Object.keys(map).length === 0) {
    map = await learnOutputMap(items.slice(0, 2), runId);
    await setOutputMap(key, map);
  }
  return { items, map };
}

/** Finds vacancies for one occupation in one location and stores them. Returns the vacancy ids. */
export async function findVacancies(
  occupation: Occupation,
  location: Location,
  remote: "only" | "ok" | "no",
  max: number,
  runId: string,
  sources: string[] = ["apify"],
  termsOverride?: string[],
): Promise<string[]> {
  const terms = termsOverride?.length ? termsOverride : await searchTerms(occupation, location.country, runId);
  // Job boards are searched in the country's language, so a nurse in Germany is found as "Pflegefachkraft".
  const vars: Vars = { query: terms[0]!, location: location.city ?? countryName(location.country), country: location.country };
  const batches: { items: unknown[]; map: Record<string, string>; tool: Source["tool"] }[] = [];

  const free = await freeJobs(terms, location, remote, max, runId);
  batches.push({ items: free, map: IDENTITY_MAP, tool: "official-api" });
  if (free.length < Math.min(FREE_ENOUGH, max) && sources.includes("apify")) {
    // Try the search terms in order until a board returns enough jobs (each try is one small actor run).
    for (const term of terms.slice(0, 3)) {
      const { items, map } = await apifyJobs(location, { ...vars, query: term }, max - free.length, runId);
      batches.push({ items, map, tool: "apify" });
      if (batches.reduce((n, b) => n + b.items.length, 0) >= Math.min(FREE_ENOUGH, max)) break;
    }
  }

  const ids = new Set<string>();
  for (const batch of batches) {
    for (const item of batch.items) {
      if (ids.size >= max) break;
      const job = applyOutputMap(item, batch.map);
      if (!job) continue;
      if (remote === "only" && !job.remote) continue;
      if (remote === "no" && job.remote) continue;
      ids.add(await upsertVacancy(job, item, occupation, location, runId, batch.tool));
    }
  }
  return [...ids];
}

type ExistingRow = { id: string; content_hash: string; repost_count: number; first_seen_at: Date };

/** Inserts or refreshes one vacancy, records a sighting, and links it to the run. */
export async function upsertVacancy(
  job: RawJob,
  rawItem: unknown,
  occupation: Occupation,
  location: Location,
  runId: string,
  tool: Source["tool"] = "apify",
): Promise<string> {
  const canonical = canonicalUrl(job.url);
  const contentHash = sha256(`${job.title}\n${job.company}\n${job.description}`);
  const snap = await saveSnapshot(JSON.stringify(rawItem), "json");
  const now = new Date().toISOString();
  const companyId = await upsertCompany(job.company, location.country);

  const source: Source = { id: newId("src"), url: job.url, title: job.title, fetchedAt: now, tool, contentHash: snap.hash, snapshotKey: snap.key };
  const salary =
    job.currency && (job.salaryMin || job.salaryMax)
      ? { min: job.salaryMin, max: job.salaryMax, currency: job.currency, period: job.salaryPeriod ?? "month", source }
      : undefined;
  const data = {
    companyId,
    canonicalUrl: canonical,
    title: job.title,
    lang: "und",
    occupation,
    location: { country: location.country, city: location.city, remote: job.remote ?? false },
    requirements: [],
    salary,
    postedAt: job.postedAt,
    // internal fields, stripped before the API returns a vacancy
    description: job.description,
    sourceUrl: job.url,
    sourceTool: tool,
    snapshotKey: snap.key,
    snapshotHash: snap.hash,
    query: { occupationUri: occupation.uri, country: location.country, city: location.city ?? null },
  };

  const [existing] = await query<ExistingRow>("SELECT id, content_hash, repost_count, first_seen_at FROM vacancies WHERE canonical_url = $1", [canonical]);
  let id: string;
  if (existing) {
    id = existing.id;
    if (existing.content_hash === contentHash) {
      await query("UPDATE vacancies SET last_seen_at = now() WHERE id = $1", [id]);
    } else {
      await query("UPDATE vacancies SET last_seen_at = now(), content_hash = $2, data = $3 WHERE id = $1", [id, contentHash, JSON.stringify(data)]);
    }
  } else {
    // The same title at the same company under a new URL counts as a repost of the older ad.
    const [previous] = await query<ExistingRow>(
      `SELECT id, content_hash, repost_count, first_seen_at FROM vacancies
       WHERE company_id = $1 AND lower(data->>'title') = lower($2) ORDER BY last_seen_at DESC LIMIT 1`,
      [companyId, job.title],
    );
    id = newId("vac");
    await query(
      `INSERT INTO vacancies (id, company_id, canonical_url, content_hash, data, first_seen_at, last_seen_at, repost_count)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
      [id, companyId, canonical, contentHash, JSON.stringify(data), previous?.first_seen_at ?? now, previous ? previous.repost_count + 1 : 0],
    );
  }
  await query("INSERT INTO vacancy_sightings (vacancy_id, seen_at, url, content_hash, source) VALUES ($1, now(), $2, $3, $4)", [id, job.url, contentHash, tool]);
  await query("INSERT INTO run_vacancies (run_id, vacancy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [runId, id]);
  await query("INSERT INTO run_companies (run_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [runId, companyId]);
  return id;
}
