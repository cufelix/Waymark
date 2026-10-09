// Then vs now: how an occupation's skill demand changed over about ten years, so advice built on older
// career paths (a senior's route in from a decade ago) is checked against today's market.
// Works for every profession and uses no personal data: it reads dated job ads and career writing.
import { z } from "zod";
import type { JobMarket, Occupation, OccupationTrends, SkillTrend, Source } from "../../contracts";
import { newId, sha256 } from "../../ids";
import { chatJson } from "../../llm";
import { errorMessage, log } from "../../log";
import { resolveSkill } from "../../shared/taxonomy";
import { toolRegistry } from "../../tools";
import { runTool } from "../../tools/types";
import { quoteInText } from "./normalise";

export type Era = { from: string; to: string };
export type { OccupationTrends, SkillTrend };


type Doc = { url: string; title: string; text: string };

const DOCS_PER_ERA = 8;
const MIN_DOCS = 3;
const SHIFT = 0.2;

export function eras(now = new Date()): { then: Era; now: Era } {
  const y = now.getUTCFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    then: { from: `${y - 10}-01-01`, to: `${y - 7}-12-31` },
    now: { from: iso(new Date(now.getTime() - 365 * 86_400_000)), to: iso(now) },
  };
}

/** Pure: shares per skill and the trend label. Skills seen in fewer than 2 documents are dropped as noise. */
export function computeTrends(
  thenHits: Map<string, number>,
  thenDocs: number,
  nowHits: Map<string, number>,
  nowDocs: number,
  vacancyShare: Map<string, number>,
): Map<string, { thenShare: number; nowShare: number; trend: SkillTrend["trend"] }> {
  const out = new Map<string, { thenShare: number; nowShare: number; trend: SkillTrend["trend"] }>();
  for (const uri of new Set([...thenHits.keys(), ...nowHits.keys(), ...vacancyShare.keys()])) {
    const t = thenHits.get(uri) ?? 0;
    const n = nowHits.get(uri) ?? 0;
    if (t + n < 2 && !vacancyShare.has(uri)) continue;
    const thenShare = thenDocs ? t / thenDocs : 0;
    // Today's vacancies are the ground truth for "now"; dated writing fills in where we have few ads.
    const nowShare = Math.max(nowDocs ? n / nowDocs : 0, vacancyShare.get(uri) ?? 0);
    const trend = nowShare - thenShare >= SHIFT ? "rising" : thenShare - nowShare >= SHIFT ? "fading" : "stable";
    out.set(uri, { thenShare: round(thenShare), nowShare: round(nowShare), trend });
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;

const Extracted = z.object({ docs: z.array(z.object({ i: z.coerce.number(), skills: z.array(z.object({ label: z.string(), quote: z.string() })) })) });
const BATCH = 4;

async function searchEra(term: string, era: Era, runId: string): Promise<Doc[]> {
  const tool = toolRegistry.get("exa_search");
  if (!tool?.available()) return [];
  const res = await runTool(
    tool,
    { query: `${term} job requirements skills`, numResults: DOCS_PER_ERA, startPublishedDate: era.from, endPublishedDate: era.to },
    { runId },
  );
  if (!res.ok || !Array.isArray(res.raw)) return [];
  return (res.raw as { url?: string; title?: string; text?: string }[])
    .filter((d) => d.url && d.text && d.text.length > 200)
    .map((d) => ({ url: d.url!, title: d.title ?? d.url!, text: d.text! }));
}

/** Which skills each document asks for; only verbatim quotes count. Returns skill uri → document count, plus quotes. */
async function skillHits(docs: Doc[], runId: string): Promise<{ hits: Map<string, number>; quotes: Map<string, Source[]>; labels: Map<string, SkillTrend["skill"]> }> {
  const hits = new Map<string, number>();
  const quotes = new Map<string, Source[]>();
  const labels = new Map<string, SkillTrend["skill"]>();
  if (docs.length === 0) return { hits, quotes, labels };
  const extracted: { i: number; skills: { label: string; quote: string }[] }[] = [];
  for (let start = 0; start < docs.length; start += BATCH) {
    const batch = docs.slice(start, start + BATCH);
    const { value } = await chatJson(
      Extracted,
      "You read job ads and career articles and list the professional skills each one says the job needs.",
      `For each document, list up to 10 skills the job needs, each with a short exact quote (under 80 characters, copied character for character) from that document. ` +
        `Use short standard skill names. Return {"docs":[{"i":0,"skills":[{"label":"...","quote":"..."}]}]} with i = the document number.\n\n` +
        batch.map((d, i) => `### Document ${i}\n${d.text.slice(0, 2000)}`).join("\n\n"),
      { runId, maxTokens: 3000 },
    );
    extracted.push(...value.docs.map((d) => ({ ...d, i: d.i + start })));
  }
  for (const { i, skills } of extracted) {
    const doc = docs[i];
    if (!doc) continue;
    const seen = new Set<string>();
    for (const s of skills.filter((k) => quoteInText(k.quote, doc.text)).slice(0, 10)) {
      const skill = await resolveSkill(s.label);
      if (seen.has(skill.uri)) continue;
      seen.add(skill.uri);
      labels.set(skill.uri, skill);
      hits.set(skill.uri, (hits.get(skill.uri) ?? 0) + 1);
      const list = quotes.get(skill.uri) ?? [];
      if (list.length < 2) {
        list.push({ id: newId("src"), url: doc.url, title: doc.title, fetchedAt: new Date().toISOString(), tool: "exa", quote: s.quote, contentHash: sha256(doc.text) });
      }
      quotes.set(skill.uri, list);
    }
  }
  return { hits, quotes, labels };
}

/** Trends for each target occupation, using its search terms and today's vacancy demand from the market. */
export async function skillTrends(
  occupations: { occupation: Occupation; term: string }[],
  market: JobMarket[],
  runId: string,
): Promise<OccupationTrends[]> {
  const { then, now } = eras();
  const out: OccupationTrends[] = [];
  for (const { occupation, term } of occupations) {
    try {
      const [thenDocs, nowDocs] = await Promise.all([searchEra(term, then, runId), searchEra(term, now, runId)]);
      if (thenDocs.length < MIN_DOCS || nowDocs.length < MIN_DOCS) {
        out.push({ occupation, then, now, thenDocs: thenDocs.length, nowDocs: nowDocs.length, skills: [] });
        continue;
      }
      const [t, n] = await Promise.all([skillHits(thenDocs, runId), skillHits(nowDocs, runId)]);
      const vacancyShare = new Map<string, number>();
      const labels = new Map([...t.labels, ...n.labels]);
      for (const m of market.filter((m) => m.occupation.uri === occupation.uri)) {
        for (const d of m.skillDemand) {
          vacancyShare.set(d.skill.uri, Math.max(vacancyShare.get(d.skill.uri) ?? 0, d.vacanciesTotal ? d.vacanciesRequiring / d.vacanciesTotal : 0));
          labels.set(d.skill.uri, d.skill);
        }
      }
      const shares = computeTrends(t.hits, thenDocs.length, n.hits, nowDocs.length, vacancyShare);
      const skills: SkillTrend[] = [...shares.entries()]
        .map(([uri, s]) => ({ skill: labels.get(uri)!, ...s, sources: [...(t.quotes.get(uri) ?? []), ...(n.quotes.get(uri) ?? [])] }))
        .filter((s) => s.skill && s.sources.length > 0)
        .sort((a, b) => Math.abs(b.nowShare - b.thenShare) - Math.abs(a.nowShare - a.thenShare));
      out.push({ occupation, then, now, thenDocs: thenDocs.length, nowDocs: nowDocs.length, skills });
    } catch (err) {
      log.warn("skill trends failed", { runId, occupation: occupation.uri, error: errorMessage(err) });
    }
  }
  return out;
}
