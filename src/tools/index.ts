import { apifyRunActor, apifyStoreSearch } from "./apify";
import { exaContents, exaSearch } from "./exa";
import { firecrawlMap, firecrawlScrape } from "./firecrawl";
import { githubApi } from "./github";
import { gleifSearch } from "./gleif";
import { freeJobsSearch } from "./jobs";
import type { Tool } from "./types";
import { fetchUrl } from "./web";

export { apifyRunActor, apifyStoreSearch, exaContents, exaSearch, fetchUrl, firecrawlMap, firecrawlScrape, freeJobsSearch, githubApi, gleifSearch };

// Each tool narrows its own params; the registry holds them as the generic Tool shape.
const asTool = (t: unknown): Tool => t as Tool;

export const allTools: Tool[] = [
  fetchUrl, firecrawlScrape, firecrawlMap, apifyStoreSearch, apifyRunActor, exaSearch, exaContents, githubApi, gleifSearch, freeJobsSearch,
].map(asTool);

export const toolRegistry: Map<string, Tool> = new Map(allTools.map((t) => [t.name, t]));

const pick = (...names: string[]): Tool[] => names.map((n) => toolRegistry.get(n)).filter((t): t is Tool => !!t);

/** Tools for reading a seeker's input (links, profiles, portfolios). */
export const readerTools: Tool[] = pick(
  "fetch_url", "firecrawl_scrape", "firecrawl_map", "apify_store_search", "apify_run_actor", "exa_search", "exa_contents", "github_api",
);

/** Tools for finding vacancies and company pages. */
export const marketTools: Tool[] = pick("free_jobs_search", "apify_store_search", "apify_run_actor", "exa_search", "exa_contents", "firecrawl_scrape", "fetch_url");
