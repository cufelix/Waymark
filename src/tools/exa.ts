// Exa: semantic web search (also people and company profiles) and page contents.
import Exa from "exa-js";
import { config } from "../config";
import type { Tool } from "./types";

// ponytail: list prices from Exa's pricing page; replace with the API's costDollars when it is reliable
const SEARCH_USD = 0.007;
const CONTENT_USD = 0.001;

export type ExaResult = { url: string; title: string; text: string; publishedDate?: string; author?: string };

let client: Exa | null = null;
const exa = (): Exa => (client ??= new Exa(config.EXA_API_KEY));

const toResult = (r: { url: string; title?: string | null; text?: string; publishedDate?: string; author?: string | null }): ExaResult => ({
  url: r.url,
  title: r.title ?? "",
  text: r.text ?? "",
  publishedDate: r.publishedDate,
  author: r.author ?? undefined,
});

const render = (rs: ExaResult[]): string => rs.map((r) => `## ${r.title}\n${r.url}\n${r.text}`).join("\n\n") || "No results.";

export const exaSearch: Tool<{ query: string; category?: string; numResults?: number; includeDomains?: string[]; startPublishedDate?: string; endPublishedDate?: string }> = {
  name: "exa_search",
  description:
    "Paid (about $0.01). Semantic web search with page text. Use to discover pages a keyword search misses: a company's careers page, a person's related profiles, independent mentions. category can be 'company', 'people' (public professional profiles), 'news', 'research paper', 'pdf', 'personal site'. 'people' only accepts LinkedIn domains in includeDomains.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      category: { type: "string", enum: ["company", "people", "news", "research paper", "pdf", "personal site", "financial report"] },
      numResults: { type: "number", description: "Default 5, max 20" },
      includeDomains: { type: "array", items: { type: "string" } },
      startPublishedDate: { type: "string", description: "ISO date; only pages published on or after it" },
      endPublishedDate: { type: "string", description: "ISO date; only pages published on or before it" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  paid: "exa",
  available: () => !!config.EXA_API_KEY,
  async run({ query, category, numResults, includeDomains, startPublishedDate, endPublishedDate }) {
    const n = Math.min(numResults ?? 5, 20);
    const res = await exa().searchAndContents(query, {
      numResults: n,
      text: { maxCharacters: 2000 },
      ...(category ? { category: category as never } : {}),
      ...(includeDomains?.length ? { includeDomains } : {}),
      ...(startPublishedDate ? { startPublishedDate } : {}),
      ...(endPublishedDate ? { endPublishedDate } : {}),
    });
    const results = res.results.map(toResult);
    return { raw: results, text: render(results), usd: SEARCH_USD + CONTENT_USD * results.length, units: 1 + results.length };
  },
};

export const exaContents: Tool<{ urls: string[] }> = {
  name: "exa_contents",
  description:
    "Paid ($0.001 per URL). Returns the text of pages from Exa's index. Use as a fallback when fetch_url and firecrawl_scrape cannot read a page (blocked or social sites).",
  parameters: {
    type: "object",
    properties: { urls: { type: "array", items: { type: "string" }, description: "1–10 URLs" } },
    required: ["urls"],
    additionalProperties: false,
  },
  paid: "exa",
  available: () => !!config.EXA_API_KEY,
  async run({ urls }) {
    const list = urls.slice(0, 10);
    if (list.length === 0) throw new Error("urls is empty");
    const res = await exa().getContents(list, { text: { maxCharacters: 8000 } });
    const results = res.results.map(toResult);
    return { raw: results, text: render(results), url: list[0], usd: CONTENT_USD * list.length, units: list.length };
  },
};
