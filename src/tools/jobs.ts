// free_jobs_search: public, keyless job APIs (Arbeitnow, RemoteOK, Himalayas, Jobicy), merged and normalised.
import type { Tool } from "./types";

export type FreeJob = {
  source: "arbeitnow" | "remoteok" | "himalayas" | "jobicy";
  id: string;
  title: string;
  company: string;
  url: string;
  description: string;
  location: string;
  country?: string;
  remote: boolean;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  salaryPeriod?: "month" | "year";
  postedAt?: string;
  tags: string[];
};

type Params = { query: string; country?: string; remote?: boolean; limit?: number };

const UA = { "User-Agent": "EtheraResearchBot/0.1 (+https://github.com/cufelix/ethera-hack)", Accept: "application/json" };
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; jobs: FreeJob[] }>();

export const stripHtml = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

const num = (v: unknown): number | undefined => (typeof v === "number" && v > 0 ? v : undefined);
const isoFromEpoch = (s: unknown): string | undefined => (typeof s === "number" ? new Date(s * 1000).toISOString() : undefined);
const period = (p: unknown): "month" | "year" | undefined =>
  typeof p === "string" ? (/year|annual/i.test(p) ? "year" : /month/i.test(p) ? "month" : undefined) : undefined;

type Item = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// Each source: where to fetch, how to find the item list, how to normalise one item.
export const SOURCES: { name: FreeJob["source"]; url: string; list: (j: unknown) => Item[]; map: (i: Item) => FreeJob }[] = [
  {
    name: "arbeitnow",
    url: "https://www.arbeitnow.com/api/job-board-api",
    list: (j) => ((j as { data?: Item[] }).data ?? []),
    map: (i) => ({
      source: "arbeitnow", id: str(i.slug), title: str(i.title), company: str(i.company_name), url: str(i.url),
      description: stripHtml(str(i.description)), location: str(i.location),
      // Arbeitnow lists jobs in Germany; remote ones may be open more widely.
      country: i.remote ? undefined : "DE", remote: i.remote === true, postedAt: isoFromEpoch(i.created_at),
      tags: [...strs(i.tags), ...strs(i.job_types)],
    }),
  },
  {
    name: "remoteok",
    url: "https://remoteok.com/api",
    list: (j) => (Array.isArray(j) ? (j.slice(1) as Item[]) : []), // the first element is their legal notice
    map: (i) => ({
      source: "remoteok", id: str(i.id), title: str(i.position), company: str(i.company), url: str(i.url) || str(i.apply_url),
      description: stripHtml(str(i.description)), location: str(i.location), remote: true,
      salaryMin: num(i.salary_min), salaryMax: num(i.salary_max), currency: num(i.salary_min) ? "USD" : undefined,
      salaryPeriod: num(i.salary_min) ? "year" : undefined, postedAt: str(i.date) || undefined, tags: strs(i.tags),
    }),
  },
  {
    name: "himalayas",
    url: "https://himalayas.app/jobs/api?limit=100",
    list: (j) => ((j as { jobs?: Item[] }).jobs ?? []),
    map: (i) => ({
      source: "himalayas", id: str(i.guid), title: str(i.title), company: str(i.companyName), url: str(i.applicationLink) || str(i.guid),
      description: stripHtml(str(i.description) || str(i.excerpt)), location: strs(i.locationRestrictions).join(", ") || "Worldwide",
      remote: true, salaryMin: num(i.minSalary), salaryMax: num(i.maxSalary), currency: str(i.currency) || undefined,
      salaryPeriod: period(i.salaryPeriod), postedAt: isoFromEpoch(i.pubDate), tags: [...strs(i.categories), ...strs(i.seniority)],
    }),
  },
  {
    name: "jobicy",
    url: "https://jobicy.com/api/v2/remote-jobs?count=100",
    list: (j) => ((j as { jobs?: Item[] }).jobs ?? []),
    map: (i) => ({
      source: "jobicy", id: str(String(i.id ?? "")), title: str(i.jobTitle), company: str(i.companyName), url: str(i.url),
      description: stripHtml(str(i.jobDescription) || str(i.jobExcerpt)), location: str(i.jobGeo) || "Worldwide", remote: true,
      salaryMin: num(i.salaryMin), salaryMax: num(i.salaryMax), currency: str(i.salaryCurrency) || undefined,
      salaryPeriod: period(i.salaryPeriod), postedAt: str(i.pubDate) || undefined, tags: [...strs(i.jobIndustry), ...strs(i.jobType)],
    }),
  },
];

async function load(source: (typeof SOURCES)[number]): Promise<FreeJob[]> {
  const hit = cache.get(source.name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.jobs;
  const res = await fetch(source.url, { headers: UA, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`${source.name} ${res.status}`);
  const jobs = source.list(await res.json()).map(source.map).filter((j) => j.title && j.url && j.company);
  cache.set(source.name, { at: Date.now(), jobs });
  return jobs;
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter((w) => w.length >= 3);

/** Relevance: how many query words appear in the title and tags. Keeps jobs matching at least half of them. */
export function matches(job: FreeJob, query: string): boolean {
  const q = [...new Set(words(query))];
  if (q.length === 0) return true;
  const hay = new Set(words(`${job.title} ${job.tags.join(" ")}`));
  return q.filter((w) => hay.has(w)).length >= Math.ceil(q.length / 2);
}

/** Location filter: a job in that country, or a remote job not restricted to other countries. */
export function inCountry(job: FreeJob, country: string, allowRemote: boolean): boolean {
  if (job.country) return job.country === country;
  if (!job.remote || !allowRemote) return false;
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
  return /worldwide|anywhere|^$/i.test(job.location) || job.location.toLowerCase().includes(name.toLowerCase());
}

export const freeJobsSearch: Tool<Params> = {
  name: "free_jobs_search",
  description:
    "Free, keyless search across public job APIs (Arbeitnow for Germany, RemoteOK, Himalayas, Jobicy for remote jobs). " +
    "Good first choice for remote and German jobs across professions. Coverage of other countries is thin; use Apify job actors for those.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Occupation or job title, e.g. 'nurse', 'backend developer'" },
      country: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. 'DE'" },
      remote: { type: "boolean", description: "Include remote jobs (default true)" },
      limit: { type: "number", description: "Max results, default 50, max 200" },
    },
    required: ["query"],
  },
  available: () => true,
  async run({ query, country, remote = true, limit = 50 }) {
    const settled = await Promise.allSettled(SOURCES.map(load));
    const failed = SOURCES.filter((_, i) => settled[i]!.status === "rejected").map((s) => s.name);
    const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const jobs = all
      .filter((j) => matches(j, query) && (!country || inCountry(j, country, remote)))
      .slice(0, Math.min(Math.max(1, limit), 200));
    const lines = jobs.map((j) => `${j.title} — ${j.company} — ${j.location}${j.remote ? " (remote)" : ""} — ${j.url}`);
    const note = failed.length ? `\n(sources unavailable: ${failed.join(", ")})` : "";
    return { raw: jobs, text: `${jobs.length} jobs\n${lines.join("\n")}${note}`, usd: 0 };
  },
};
