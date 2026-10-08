import type { Occupation, Skill } from "../../contracts";

const ESCO_URL = "https://ec.europa.eu/esco/api/search";
const TIMEOUT_MS = 10_000;
const CACHE_MAX = 5_000;

type EscoType = "occupation" | "skill";
type Entry = { uri: string; label: string; lang: string };

const cache = new Map<string, Entry[]>();

export function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function search(type: EscoType, text: string, lang: string, limit: number): Promise<Entry[]> {
  const key = `${type}|${lang}|${text}|${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const url = new URL(ESCO_URL);
  url.search = new URLSearchParams({
    text, language: lang, type, limit: String(limit), full: "false",
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ESCO ${res.status}`);
  const body = (await res.json()) as { _embedded?: { results?: Array<{ uri?: string; title?: string }> } };
  const results: Entry[] = (body._embedded?.results ?? [])
    .filter((r): r is { uri: string; title: string } => !!r.uri && !!r.title)
    .map((r) => ({ uri: r.uri, label: r.title, lang }));

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string); // evict oldest
  cache.set(key, results);
  return results;
}

export const searchOccupations = (text: string, lang = "en", limit = 5): Promise<Occupation[]> =>
  search("occupation", text, lang, limit);

export const searchSkills = (text: string, lang = "en", limit = 5): Promise<Skill[]> =>
  search("skill", text, lang, limit);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Good match: equal title (case-insensitive) or title contains the label as a whole word. */
export function isGoodMatch(title: string, label: string): boolean {
  const t = title.toLowerCase().trim();
  const l = label.toLowerCase().trim();
  if (!l) return false;
  if (t === l) return true;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(l)}(?![\\p{L}\\p{N}])`, "u").test(t);
}

export async function resolveSkill(label: string, lang = "en"): Promise<Skill> {
  const custom: Skill = { uri: "custom:" + slug(label), label, lang };
  try {
    const results = await searchSkills(label, lang, 5);
    return results.find((r) => isGoodMatch(r.label, label)) ?? custom;
  } catch {
    return custom;
  }
}

export function clearCache(): void {
  cache.clear();
}
