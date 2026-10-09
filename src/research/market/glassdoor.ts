// Glassdoor employer reviews (via Apify): recent ratings and what employees say, as sourced company claims.
// Only reviews from the last two years, so the picture matches the company today. Reviewers are anonymous on
// Glassdoor; only review text and ratings are kept.
import type { Claim, Source } from "../../contracts";
import { query } from "../../db/pool";
import { newId, sha256 } from "../../ids";
import { errorMessage, log } from "../../log";
import { toolRegistry } from "../../tools";
import { runTool } from "../../tools/types";

const ACTOR = "memo23/glassdoor-scraper-ppr";
const MAX_REVIEWS = 20;
const RECENT_DAYS = 730;

type Review = {
  reviewId?: number; reviewDateTime?: string; ratingOverall?: number; ratingWorkLifeBalance?: number;
  ratingCareerOpportunities?: number; ratingCultureAndValues?: number; ratingRecommendToFriend?: string;
  pros?: string; cons?: string;
};

const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && x > 0);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : undefined;
};

/** The company's Glassdoor reviews page, found with Exa. */
async function reviewsUrl(company: string, runId: string): Promise<string | null> {
  const exa = toolRegistry.get("exa_search");
  if (!exa?.available()) return null;
  const res = await runTool(exa, { query: `${company} company reviews Glassdoor`, numResults: 5, includeDomains: ["glassdoor.com"] }, { runId });
  const urls = res.ok && Array.isArray(res.raw) ? (res.raw as { url: string }[]).map((r) => r.url) : [];
  // The employer-wide reviews page ("/Reviews/<Name>-Reviews-E123.htm"), not a role-specific one.
  return urls.find((u) => /glassdoor\.[a-z.]+\/Reviews\/[^/]+-Reviews-E\d+\.htm/i.test(u)) ?? null;
}

/** Pure: claims from recent reviews. Ratings are averages over the reviews read; quotes are verbatim. */
export function reviewClaims(companyId: string, url: string, reviews: Review[], now = new Date()): Claim[] {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const recent = reviews.filter((r) => !r.reviewDateTime || new Date(r.reviewDateTime) >= since);
  if (recent.length === 0) return [];
  const fetchedAt = now.toISOString();
  const src = (quote?: string): Source => ({ id: newId("src"), url, title: "Glassdoor employee reviews", fetchedAt, tool: "apify", contentHash: sha256(url + (quote ?? "")), ...(quote ? { quote: quote.slice(0, 300) } : {}) });
  const claim = (statement: string, kind: Claim["kind"], sources: Source[]): Claim => ({
    id: newId("clm"), subject: { kind: "company", id: companyId }, statement, kind, tier: "single-source", sources,
  });
  const out: Claim[] = [];
  const overall = avg(recent.map((r) => r.ratingOverall));
  if (overall) out.push(claim(`Glassdoor: ${overall}/5 average over ${recent.length} reviews from the last two years`, "fact", [src()]));
  const recommend = recent.filter((r) => r.ratingRecommendToFriend === "POSITIVE" || r.ratingRecommendToFriend === "NEGATIVE");
  if (recommend.length >= 3) {
    const pct = Math.round((recommend.filter((r) => r.ratingRecommendToFriend === "POSITIVE").length / recommend.length) * 100);
    out.push(claim(`Glassdoor: ${pct}% of ${recommend.length} recent reviewers would recommend working here`, "fact", [src()]));
  }
  for (const [label, key] of [["work-life balance", "ratingWorkLifeBalance"], ["career opportunities", "ratingCareerOpportunities"], ["culture and values", "ratingCultureAndValues"]] as const) {
    const a = avg(recent.map((r) => r[key]));
    if (a) out.push(claim(`Glassdoor: ${label} rated ${a}/5 in recent reviews`, "fact", [src()]));
  }
  const quotes = (field: "pros" | "cons") => recent.map((r) => r[field]?.trim()).filter((t): t is string => !!t && t.length > 15 && t !== "N/A").slice(0, 2);
  const pros = quotes("pros");
  const cons = quotes("cons");
  if (pros.length) out.push(claim("Employees praise, in recent Glassdoor reviews", "fact", pros.map((q) => src(q))));
  if (cons.length) out.push(claim("Employees criticise, in recent Glassdoor reviews", "fact", cons.map((q) => src(q))));
  return out;
}

/** Fetches recent Glassdoor reviews for a company and stores them as claims (replacing older Glassdoor claims). */
export async function enrichWithGlassdoor(companyId: string, runId: string): Promise<void> {
  const actor = toolRegistry.get("apify_run_actor");
  if (!actor?.available()) return;
  const [company] = await query<{ name: string; claims: Claim[] }>("SELECT name, claims FROM companies WHERE id = $1", [companyId]);
  if (!company) return;
  try {
    const url = await reviewsUrl(company.name, runId);
    if (!url) return;
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const res = await runTool(actor, {
      actorId: ACTOR,
      input: { startUrls: [{ url }], command: "reviews", reviewsStartDate: since, sortReviewsBy: "DATE", maxItems: MAX_REVIEWS },
      maxItems: MAX_REVIEWS + 2,
    }, { runId });
    if (!res.ok || !Array.isArray(res.raw)) return;
    const reviews = (res.raw as Review[]).filter((r) => r.reviewId !== undefined);
    const fresh = reviewClaims(companyId, url, reviews);
    if (fresh.length === 0) return;
    const kept = company.claims.filter((c) => !c.sources.some((s) => s.url.includes("glassdoor.")));
    await query("UPDATE companies SET claims = $2, updated_at = now() WHERE id = $1", [companyId, JSON.stringify([...kept, ...fresh])]);
  } catch (err) {
    log.warn("glassdoor enrichment failed", { runId, companyId, error: errorMessage(err) });
  }
}
