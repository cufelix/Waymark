// Firecrawl: JavaScript-rendered pages and site maps. Refuses social platforms (Instagram, TikTok, YouTube…).
import Firecrawl from "@mendable/firecrawl-js";
import { config } from "../config";
import type { Tool } from "./types";

let client: Firecrawl | null = null;
const fc = (): Firecrawl => (client ??= new Firecrawl({ apiKey: config.FIRECRAWL_API_KEY }));

export const firecrawlScrape: Tool<{ url: string }> = {
  name: "firecrawl_scrape",
  description:
    "Paid (about 1 credit per page). Renders a page with JavaScript and returns clean markdown. Use for JS-heavy sites, portfolios, career pages and online PDFs when fetch_url returns little text. Firecrawl REFUSES social platforms (Instagram, TikTok, YouTube, X, LinkedIn): use apify_store_search + apify_run_actor for those.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "Absolute http(s) URL" } },
    required: ["url"],
    additionalProperties: false,
  },
  paid: "firecrawl",
  available: () => !!config.FIRECRAWL_API_KEY,
  async run({ url }) {
    const doc = await fc().scrape(url, { formats: ["markdown", "links"] });
    const credits = (doc.metadata as { creditsUsed?: number } | undefined)?.creditsUsed ?? 1;
    const raw = { url, markdown: doc.markdown ?? "", metadata: doc.metadata ?? {}, links: doc.links ?? [] };
    return { raw, text: raw.markdown, url: (doc.metadata?.sourceURL as string | undefined) ?? url, usd: credits * config.FIRECRAWL_USD_PER_CREDIT, units: credits };
  },
};

export const firecrawlMap: Tool<{ url: string; search?: string; limit?: number }> = {
  name: "firecrawl_map",
  description:
    "Paid (1 credit). Lists the URLs of a website without scraping them. Use to find the right subpage first (careers, jobs, about, portfolio, projects), optionally filtered with `search`, then scrape only that page.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Site root or section URL" },
      search: { type: "string", description: "Optional keyword to rank URLs, e.g. 'careers'" },
      limit: { type: "number", description: "Max URLs to return (default 100)" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  paid: "firecrawl",
  available: () => !!config.FIRECRAWL_API_KEY,
  async run({ url, search, limit }) {
    const data = await fc().map(url, { search, limit: Math.min(limit ?? 100, 500) });
    const links = data.links.map((l) => ({ url: l.url, title: l.title, description: l.description }));
    return {
      raw: links,
      text: links.map((l) => `${l.url}${l.title ? ` — ${l.title}` : ""}`).join("\n"),
      url,
      usd: config.FIRECRAWL_USD_PER_CREDIT,
      units: 1,
    };
  },
};
