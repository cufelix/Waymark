// fetch_url: free plain HTTP fetch with robots.txt, a size cap and a small HTML-to-text extractor.
import { assertPublicUrl, BlockedUrlError, safeGet, type SafeGetOptions } from "./net";
import type { Tool } from "./types";

export const USER_AGENT = "EtheraResearchBot/0.1 (+https://github.com/cufelix/ethera-hack)";
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

// ---------- robots.txt ----------
type Rule = { allow: boolean; path: string };
const robotsCache = new Map<string, Rule[]>();

/** Rules for our agent from a robots.txt body: our own group if present, otherwise the `*` group. */
export function parseRobots(body: string, agent = "etheraresearchbot"): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  for (const line of body.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.replace(/#.*/, "").split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!key) continue;
    if (key === "user-agent") {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  return (mine ?? groups.find((g) => g.agents.includes("*")))?.rules ?? [];
}

/** Longest matching rule wins; Allow wins a tie. `*` and `$` wildcards are supported. */
export function isAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    const re = new RegExp("^" + rule.path.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
    if (!re.test(path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

async function robotsAllows(url: URL, deps: SafeGetOptions): Promise<boolean> {
  let rules = robotsCache.get(url.origin);
  if (!rules) {
    try {
      const res = await safeGet(`${url.origin}/robots.txt`, { ...deps, headers: { "User-Agent": USER_AGENT }, maxBytes: 512 * 1024 });
      // ponytail: unreachable or 5xx robots.txt is treated as "allow"; RFC 9309 says 5xx = disallow
      rules = res.status >= 200 && res.status < 300 ? parseRobots(res.body.toString("utf8")) : [];
    } catch (err) {
      if (err instanceof BlockedUrlError) throw err;
      rules = [];
    }
    robotsCache.set(url.origin, rules);
  }
  return isAllowed(rules, url.pathname + url.search);
}

// ---------- HTML to text ----------
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Readable text, title and absolute links from an HTML page. Dependency-free; good enough for reading, not a full parser. */
export function htmlToText(html: string, baseUrl: string): { title: string; text: string; links: string[] } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|head)\b[\s\S]*?<\/\1>/gi, " ");

  const links = new Set<string>();
  body = body.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    try {
      const abs = new URL(decodeEntities(href), baseUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") links.add(abs.href);
    } catch {
      /* ignore malformed hrefs */
    }
    return inner;
  });

  body = body
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${inner}\n\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|pre|header|main)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text, links: [...links] };
}

export type FetchRaw = { url: string; finalUrl: string; status: number; title: string; text: string; links: string[] };

/** Fetches one page safely (SSRF guard, robots.txt, size cap) and turns it into readable text. `deps` is a test seam. */
export async function fetchPage(url: string, deps: SafeGetOptions = {}): Promise<FetchRaw> {
  const target = new URL(url);
  await assertPublicUrl(target, deps.resolve);
  if (!(await robotsAllows(target, deps))) throw new Error(`robots.txt disallows ${target.pathname} on ${target.host}`);
  const res = await safeGet(target, {
    ...deps,
    maxBytes: MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5" },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers["content-type"] ?? "";
  if (type !== "" && !/(text\/|json|xml|html)/i.test(type)) {
    throw new Error(`Unsupported content type "${type}" (binary); use firecrawl_scrape for PDFs`);
  }
  const body = res.body.toString("utf8");
  const base = { url, finalUrl: res.finalUrl, status: res.status };
  if (/json/i.test(type)) return { ...base, title: "", text: body, links: [] };
  if (/html|xml/i.test(type) || /^\s*</.test(body)) return { ...base, ...htmlToText(body, res.finalUrl) };
  return { ...base, title: "", text: body.trim(), links: [] };
}

export const fetchUrl: Tool<{ url: string }> = {
  name: "fetch_url",
  description:
    "Free. Plain HTTP GET of a public web page or JSON endpoint; returns readable text, title and links. Try this first for simple sites (personal sites, blogs, docs, JSON APIs). It does not run JavaScript: if the text comes back nearly empty, use firecrawl_scrape. Respects robots.txt. Does not work for social platforms that need JavaScript or block bots (use apify_store_search + apify_run_actor for those).",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "Absolute http(s) URL" } },
    required: ["url"],
    additionalProperties: false,
  },
  available: () => true,
  async run({ url }) {
    const raw = await fetchPage(url);
    return { raw, text: raw.title ? `${raw.title}\n\n${raw.text}` : raw.text, url: raw.finalUrl, usd: 0 };
  },
};
