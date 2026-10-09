// Company research: one row per company and country, registry facts, website, and ghost-job signals.
import type { Claim, ResearchOptions, Source } from "../../contracts";
import { query } from "../../db/pool";
import { newId, sha256 } from "../../ids";
import { runTool } from "../../tools/types";
import { toolRegistry } from "../../tools";
import { normaliseCompanyName } from "./normalise";

/** Returns the id of the company with this name in this country, creating it when new. */
export async function upsertCompany(name: string, country: string, domain?: string): Promise<string> {
  const nameKey = normaliseCompanyName(name) || name.toLowerCase().trim();
  const [row] = await query<{ id: string }>(
    `INSERT INTO companies (id, name, name_key, country, domain) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name_key, country) DO UPDATE SET updated_at = now(), domain = COALESCE(companies.domain, EXCLUDED.domain)
     RETURNING id`,
    [newId("cmp"), name.trim(), nameKey, country, domain ?? null],
  );
  if (!row) throw new Error(`could not upsert company ${name}`);
  return row.id;
}

export async function linkRunCompany(runId: string, companyId: string, isDream: boolean): Promise<void> {
  await query(
    `INSERT INTO run_companies (run_id, company_id, is_dream) VALUES ($1, $2, $3)
     ON CONFLICT (run_id, company_id) DO UPDATE SET is_dream = run_companies.is_dream OR EXCLUDED.is_dream`,
    [runId, companyId, isDream],
  );
}

type CompanyRow = { id: string; name: string; name_key: string; domain: string | null; country: string; registry_ids: { scheme: string; id: string }[]; claims: Claim[] };

const source = (url: string, title: string, tool: Source["tool"], content: string): Source => ({
  id: newId("src"), url, title, fetchedAt: new Date().toISOString(), tool, contentHash: sha256(content),
});

const claim = (companyId: string, statement: string, tier: Claim["tier"], kind: Claim["kind"], sources: Source[]): Claim => ({
  id: newId("clm"), subject: { kind: "company", id: companyId }, statement, kind, tier, sources,
});

type GleifRecord = { lei: string; legalName: string; country?: string; status?: string };
type ExaResult = { url: string; title?: string };

/** Adds an LEI registry fact (exact normalised name match only) and the company website. Never throws. */
export async function enrichCompany(companyId: string, options: Pick<ResearchOptions, "sources">, runId: string): Promise<void> {
  const [c] = await query<CompanyRow>("SELECT id, name, name_key, domain, country, registry_ids, claims FROM companies WHERE id = $1", [companyId]);
  if (!c) return;
  const claims = [...c.claims];
  const registryIds = [...c.registry_ids];
  let domain = c.domain;

  const gleif = toolRegistry.get("gleif_search");
  if (gleif && options.sources.includes("registry") && !registryIds.some((r) => r.scheme === "lei")) {
    const res = await runTool(gleif, { name: c.name, country: c.country }, { runId });
    const match = res.ok && Array.isArray(res.raw)
      ? (res.raw as GleifRecord[]).find((r) => normaliseCompanyName(r.legalName) === c.name_key)
      : undefined;
    if (match) {
      registryIds.push({ scheme: "lei", id: match.lei });
      const url = `https://search.gleif.org/#/record/${match.lei}`;
      const statement = `Registered legal entity ${match.legalName}, LEI ${match.lei}, status ${match.status ?? "unknown"}`;
      claims.push(claim(c.id, statement, "verified", "fact", [source(url, `GLEIF record ${match.lei}`, "registry", JSON.stringify(match))]));
    }
  }

  const exa = toolRegistry.get("exa_search");
  if (exa && options.sources.includes("exa") && !domain) {
    const res = await runTool(exa, { query: `${c.name} company`, category: "company", numResults: 3 }, { runId });
    const hit = res.ok && Array.isArray(res.raw)
      ? (res.raw as ExaResult[]).find((r) => normaliseCompanyName(r.title ?? "").includes(c.name_key))
      : undefined;
    if (hit) {
      domain = new URL(hit.url).hostname.replace(/^www\./, "");
      claims.push(claim(c.id, `Company website ${domain}`, "single-source", "fact", [source(hit.url, hit.title ?? domain, "exa", hit.url)]));
    }
  }

  await query("UPDATE companies SET claims = $2, registry_ids = $3, domain = $4, updated_at = now() WHERE id = $1", [
    c.id, JSON.stringify(claims), JSON.stringify(registryIds), domain,
  ]);
}

export type VacancyHistory = {
  id: string;
  title: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  repostCount: number;
  sightings: { url: string; seenAt: Date; contentHash: string }[];
};

const DAY = 86_400_000;

/** Ghost-job signals from our own history only. Always inferences, each citing the sightings. */
export function ghostClaims(companyId: string, vacancies: VacancyHistory[], now = new Date()): Claim[] {
  const out: Claim[] = [];
  for (const v of vacancies) {
    const sources = v.sightings.slice(0, 5).map((s) => ({
      id: newId("src"), url: s.url, title: v.title, fetchedAt: s.seenAt.toISOString(), tool: "apify" as const, contentHash: s.contentHash,
    }));
    if (sources.length === 0) continue;
    const stillOpen = now.getTime() - v.lastSeenAt.getTime() <= 14 * DAY;
    const daysOpen = Math.floor((v.lastSeenAt.getTime() - v.firstSeenAt.getTime()) / DAY);
    if (stillOpen && daysOpen > 90) {
      out.push(claim(companyId, `"${v.title}" has been listed for ${daysOpen} days`, "single-source", "inference", sources));
    }
    if (v.repostCount >= 3) {
      out.push(claim(companyId, `"${v.title}" was reposted ${v.repostCount} times`, "single-source", "inference", sources));
    }
  }
  return out;
}

/** Recomputes the ghost signals of one company from its vacancy history. */
export async function refreshGhostSignals(companyId: string): Promise<void> {
  const rows = await query<{ id: string; title: string; first_seen_at: Date; last_seen_at: Date; repost_count: number; sightings: { url: string; seen_at: string; content_hash: string }[] | null }>(
    `SELECT v.id, v.data->>'title' AS title, v.first_seen_at, v.last_seen_at, v.repost_count,
            (SELECT json_agg(json_build_object('url', s.url, 'seen_at', s.seen_at, 'content_hash', s.content_hash) ORDER BY s.seen_at DESC)
               FROM vacancy_sightings s WHERE s.vacancy_id = v.id) AS sightings
       FROM vacancies v WHERE v.company_id = $1`,
    [companyId],
  );
  const history: VacancyHistory[] = rows.map((r) => ({
    id: r.id, title: r.title, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, repostCount: r.repost_count,
    sightings: (r.sightings ?? []).map((s) => ({ url: s.url, seenAt: new Date(s.seen_at), contentHash: s.content_hash })),
  }));
  await query("UPDATE companies SET ghost_signals = $2 WHERE id = $1", [companyId, JSON.stringify(ghostClaims(companyId, history))]);
}
