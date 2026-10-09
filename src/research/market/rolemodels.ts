// Role models: what people already working at the target companies build NOW, so the seeker is pointed at
// projects that matter today, not the ones that got someone hired ten years ago.
// Public GitHub data only, reported in aggregate (counts and links to public repos, never a list of people).
import { z } from "zod";
import type { Occupation, ProjectTheme, RoleModelInsights, Source, TechTrend } from "../../contracts";
import { query } from "../../db/pool";
import { newId } from "../../ids";
import { chatJson } from "../../llm";
import { errorMessage, log } from "../../log";
import { gh, mapLimit } from "./github";
import { toolRegistry } from "../../tools";
import { runTool } from "../../tools/types";

const PEOPLE_PER_ORG = 15;
const MAX_ORGS = 5;
const NOW_CREATED_MONTHS = 24;   // a "now" project was started in the last two years…
const NOW_PUSHED_MONTHS = 12;    // …and is still being worked on
const THEN_YEARS = 5;            // "then": started more than five years ago

type Repo = {
  full_name: string; html_url: string; description: string | null; language: string | null; topics?: string[];
  stargazers_count: number; fork: boolean; created_at: string; pushed_at: string; owner: { login: string };
};

const monthsAgo = (m: number, now: Date) => new Date(now.getTime() - m * 30.44 * 86_400_000);
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

export type EvidencePlatform = { platform: "github" | "web" | "none"; domains: string[]; workWord: string };
const platformCache = new Map<string, EvidencePlatform>();

/**
 * Where people in this occupation show their work in public, decided per occupation (adaptive, any job):
 * GitHub for code, portfolio or publishing sites for other work (Behance, Dribbble, SoundCloud, Kaggle…), none
 * where work isn't shown publicly (a nurse, an electrician).
 */
async function evidencePlatform(occupation: Occupation, runId: string): Promise<EvidencePlatform> {
  const hit = platformCache.get(occupation.uri);
  if (hit) return hit;
  const { value } = await chatJson(
    z.object({ platform: z.enum(["github", "web", "none"]), domains: z.array(z.string()).default([]), workWord: z.string().default("project") }),
    "You know where professionals in every occupation publish their work online.",
    `Occupation: "${occupation.label}". Where do people in this job publicly show their recent work?\n` +
      `- "github" if the work is mainly code (software, data, ML).\n` +
      `- "web" if they publish work on other public sites; give up to 4 site domains where it is typically published (e.g. behance.net, dribbble.com, soundcloud.com, kaggle.com, youtube.com, medium.com) and workWord, the word for one piece of work (e.g. "case study", "track", "notebook").\n` +
      `- "none" if the work is not usually shown publicly.\n` +
      `Return {"platform":"web","domains":["behance.net"],"workWord":"case study"}.`,
    { runId, maxTokens: 400 },
  );
  const domains = value.domains.map((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 4);
  const result: EvidencePlatform = value.platform === "web" && domains.length === 0 ? { platform: "none", domains: [], workWord: "" } : { ...value, domains };
  platformCache.set(occupation.uri, result);
  return result;
}

/** The company's GitHub organization, when its login clearly matches the company name. */
async function findOrg(company: string): Promise<string | null> {
  const n = norm(company.replace(/\b(inc|llc|ltd|gmbh|s\.?r\.?o\.?|a\.?s\.?|ag|se|corp|corporation|company)\b\.?/gi, ""));
  if (n.length < 3) return null;
  const res = await gh<{ items: { login: string }[] }>(`/search/users?q=${encodeURIComponent(company)}+type:org&per_page=5`);
  const login = res?.items.map((i) => i.login).find((l) => norm(l) === n || (norm(l).startsWith(n) && norm(l).length - n.length <= 4));
  return login ?? null;
}

/** Pure: n items spread evenly across the list. */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);
}

/** Pure: languages and topics, as the share of role models using each now vs then. */
export function techTrends(now: Repo[], then: Repo[]): TechTrend[] {
  const share = (repos: Repo[], pick: (r: Repo) => string[]) => {
    const people = new Set(repos.map((r) => r.owner.login));
    const by = new Map<string, Set<string>>();
    for (const r of repos) for (const k of pick(r)) by.set(k, (by.get(k) ?? new Set()).add(r.owner.login));
    return { people: people.size, by };
  };
  const out: TechTrend[] = [];
  for (const [kind, pick] of [["language", (r: Repo) => (r.language ? [r.language] : [])], ["topic", (r: Repo) => r.topics ?? []]] as const) {
    const n = share(now, pick);
    const t = share(then, pick);
    for (const name of new Set([...n.by.keys(), ...t.by.keys()])) {
      const nowShare = n.people ? (n.by.get(name)?.size ?? 0) / n.people : 0;
      const thenShare = t.people ? (t.by.get(name)?.size ?? 0) / t.people : 0;
      if ((n.by.get(name)?.size ?? 0) + (t.by.get(name)?.size ?? 0) < 2) continue; // one person is not a trend
      const trend = nowShare - thenShare >= 0.15 ? "rising" : thenShare - nowShare >= 0.15 ? "fading" : "stable";
      out.push({ name, kind, nowShare: Math.round(nowShare * 100) / 100, thenShare: Math.round(thenShare * 100) / 100, trend });
    }
  }
  return out.sort((a, b) => Math.abs(b.nowShare - b.thenShare) - Math.abs(a.nowShare - a.thenShare)).slice(0, 25);
}

const Themes = z.object({
  themes: z.array(z.object({ theme: z.string(), description: z.string(), skills: z.array(z.string()).default([]), repos: z.array(z.coerce.number()) })),
});

/** Groups today's repos into project themes; examples are real repos, counts are distinct people. */
type Work = { title: string; url: string; description: string; owner: string; score: number; tags: string };
const fromRepo = (r: Repo): Work => ({ title: r.full_name, url: r.html_url, description: r.description ?? "", owner: r.owner.login, score: r.stargazers_count, tags: `[${r.language ?? "-"}] ${(r.topics ?? []).slice(0, 6).join(",")}` });

async function projectThemes(works: Work[], occupation: Occupation, runId: string): Promise<ProjectTheme[]> {
  const top = [...works].sort((a, b) => b.score - a.score).slice(0, 80);
  if (top.length < 3) return [];
  const { value } = await chatJson(
    Themes,
    "You read lists of recent GitHub projects and name the kinds of projects people build.",
    `These are recent public works (from the last two years) by people working as ${occupation.label}, at or near the companies a job seeker targets. ` +
      `Group them into up to 6 project themes that a junior could build today to show the same skills. For each: theme (short), description (one sentence), ` +
      `skills (3-6 short skill names) and repos (the numbers of the projects in it). Return {"themes":[{"theme":"...","description":"...","skills":["..."],"repos":[0,3]}]}.\n\n` +
      top.map((w, i) => `${i}. ${w.title} ${w.tags} — ${w.description.slice(0, 160)}`).join("\n"),
    { runId, maxTokens: 2500 },
  );
  const now = new Date().toISOString();
  return value.themes
    .map((t) => {
      const members = [...new Set(t.repos)].map((i) => top[i]).filter((w): w is Work => !!w);
      const examples: Source[] = [...members].sort((a, b) => b.score - a.score).slice(0, 3).map((w) => ({
        id: newId("src"), url: w.url, title: w.title, fetchedAt: now, tool: "official-api",
        ...(w.description ? { quote: w.description.slice(0, 200) } : {}), contentHash: w.url,
      }));
      return { theme: t.theme, description: t.description, skills: t.skills.slice(0, 6), roleModels: new Set(members.map((w) => w.owner)).size, examples };
    })
    .filter((t) => t.roleModels >= 2 && t.examples.length > 0)   // a theme needs more than one person behind it
    .sort((a, b) => b.roleModels - a.roleModels);
}

/** Role-model insights for one occupation, from the dream companies first, then the companies hiring in this run. */
export async function roleModels(runId: string, occupation: Occupation, dreamCompanies: string[], now = new Date()): Promise<RoleModelInsights | null> {
  let where: EvidencePlatform;
  try {
    where = await evidencePlatform(occupation, runId);
  } catch (err) {
    log.warn("role models: platform choice failed", { runId, error: errorMessage(err) });
    return null;
  }
  if (where.platform === "none") return null;
  const hiring = await query<{ name: string }>(
    `SELECT c.name, count(*) AS n FROM run_vacancies rv JOIN vacancies v ON v.id = rv.vacancy_id JOIN companies c ON c.id = v.company_id
     WHERE rv.run_id = $1 AND v.data->'query'->>'occupationUri' = $2 GROUP BY c.name ORDER BY n DESC LIMIT 10`,
    [runId, occupation.uri],
  );
  const candidates = [...new Set([...dreamCompanies, ...hiring.map((h) => h.name)])];
  if (where.platform === "web") return webRoleModels(runId, occupation, candidates.slice(0, MAX_ORGS), where, now);
  const orgs = (await mapLimit(candidates, 4, async (name) => ({ name, org: await findOrg(name) }))).filter((o): o is { name: string; org: string } => !!o.org).slice(0, MAX_ORGS);
  if (orgs.length === 0) return null;

  const people = await mapLimit(orgs, 4, async (o) => {
    // GitHub lists members alphabetically; read a few pages and take an evenly spread sample, not the first names.
    const pages = await mapLimit([1, 2, 3], 3, (page) => gh<{ login: string }[]>(`/orgs/${o.org}/public_members?per_page=100&page=${page}`));
    return { ...o, logins: spread(pages.flatMap((p) => p ?? []).map((m) => m.login), PEOPLE_PER_ORG) };
  });
  const logins = [...new Set(people.flatMap((p) => p.logins))];
  const repos = (await mapLimit(logins, 8, (l) => gh<Repo[]>(`/users/${l}/repos?type=owner&sort=pushed&per_page=50`))).flatMap((r) => r ?? []).filter((r) => !r.fork);

  const nowRepos = repos.filter((r) => new Date(r.created_at) >= monthsAgo(NOW_CREATED_MONTHS, now) && new Date(r.pushed_at) >= monthsAgo(NOW_PUSHED_MONTHS, now));
  const thenRepos = repos.filter((r) => new Date(r.created_at) < monthsAgo(THEN_YEARS * 12, now));
  let themesNow: ProjectTheme[] = [];
  try {
    themesNow = await projectThemes(nowRepos.map(fromRepo), occupation, runId);
  } catch (err) {
    log.warn("role models: themes failed", { runId, error: errorMessage(err) });
  }
  return {
    occupation,
    platform: "github",
    sites: ["github.com"],
    companies: people.map((p) => ({ name: p.name, githubOrg: p.org, roleModels: p.logins.length })),
    roleModelsRead: logins.length,
    window: { nowSince: monthsAgo(NOW_CREATED_MONTHS, now).toISOString().slice(0, 10), thenBefore: monthsAgo(THEN_YEARS * 12, now).toISOString().slice(0, 10) },
    themesNow,
    techTrends: techTrends(nowRepos, thenRepos),
  };
}

/** Owner of a public work: the account in the URL path, or the subdomain on per-account hosts. */
function ownerOf(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    return `${u.hostname}/${seg.replace(/^@/, "")}`;
  } catch {
    return url;
  }
}

/** Role models for non-code jobs: recent public work on the occupation's own platforms, found with Exa. */
async function webRoleModels(runId: string, occupation: Occupation, companies: string[], where: EvidencePlatform, now: Date): Promise<RoleModelInsights | null> {
  const exa = toolRegistry.get("exa_search");
  if (!exa?.available()) return null;
  const since = monthsAgo(NOW_CREATED_MONTHS, now).toISOString().slice(0, 10);
  const queries = [...companies.map((c) => `${occupation.label} ${c} ${where.workWord}`), `${occupation.label} ${where.workWord}`];
  const found = await mapLimit(queries, 3, async (q) => {
    const res = await runTool(exa, { query: q, numResults: 10, includeDomains: where.domains, startPublishedDate: since }, { runId });
    return res.ok && Array.isArray(res.raw) ? (res.raw as { url: string; title?: string; text?: string }[]) : [];
  });
  const works = [...new Map(found.flat().map((r) => [r.url, r])).values()].map((r, i) => ({
    title: r.title ?? r.url, url: r.url, description: (r.text ?? "").slice(0, 300), owner: ownerOf(r.url), score: 100 - i, tags: "",
  }));
  if (works.length < 3) return null;
  let themesNow: ProjectTheme[] = [];
  try {
    themesNow = await projectThemes(works, occupation, runId);
  } catch (err) {
    log.warn("role models: web themes failed", { runId, error: errorMessage(err) });
  }
  return {
    occupation,
    platform: "web",
    sites: where.domains,
    companies: companies.map((name) => ({ name, githubOrg: "", roleModels: 0 })),
    roleModelsRead: new Set(works.map((w) => w.owner)).size,
    window: { nowSince: since, thenBefore: monthsAgo(THEN_YEARS * 12, now).toISOString().slice(0, 10) },
    themesNow,
    techTrends: [],
  };
}
