// Apify: find a ready-made actor in the store, then run it with a small item limit.
import { ApifyClient } from "apify-client";
import { config } from "../config";
import { clip, type Tool } from "./types";
import { PaidToolError } from "./types";

export type StoreActor = {
  id: string;                 // "username/name", the value apify_run_actor takes
  title: string;
  description: string;
  users30d: number;
  runs30d: number;
  successRate30d: number;     // 0–1, from public runs in the last 30 days
  lastRunAt?: string;
  rating?: number;
  pricingModel?: string;
  pricePerUnitUsd?: number;
  deprecated: boolean;
  eligible: boolean;          // safe enough to run: see isEligible
};

type StoreItem = {
  username: string;
  name: string;
  title?: string;
  description?: string;
  notice?: string;
  actorReviewRating?: number;
  stats?: {
    totalUsers30Days?: number;
    lastRunStartedAt?: string;
    publicActorRunStats30Days?: { SUCCEEDED?: number; TOTAL?: number };
  };
  currentPricingInfo?: { pricingModel?: string; pricePerUnitUsd?: number };
};

/**
 * An actor is eligible when it isn't deprecated and is clearly in real use: at least 50 users in 30 days,
 * or at least 20 public runs in 30 days with an 80% success rate (niche platforms like SoundCloud rarely reach 50 users).
 */
export function isEligible(a: Pick<StoreActor, "users30d" | "runs30d" | "successRate30d" | "deprecated">): boolean {
  if (a.deprecated) return false;
  return a.users30d >= 50 || (a.runs30d >= 20 && a.successRate30d >= 0.8);
}

export function mapStoreItem(it: StoreItem): StoreActor {
  const runs = it.stats?.publicActorRunStats30Days;
  const runs30d = runs?.TOTAL ?? 0;
  const actor = {
    id: `${it.username}/${it.name}`,
    title: it.title ?? it.name,
    description: (it.description ?? "").slice(0, 300),
    users30d: it.stats?.totalUsers30Days ?? 0,
    runs30d,
    successRate30d: runs30d ? (runs?.SUCCEEDED ?? 0) / runs30d : 0,
    lastRunAt: it.stats?.lastRunStartedAt,
    rating: it.actorReviewRating,
    pricingModel: it.currentPricingInfo?.pricingModel,
    pricePerUnitUsd: it.currentPricingInfo?.pricePerUnitUsd,
    deprecated: /deprecat/i.test(it.notice ?? "") || /deprecat/i.test(it.title ?? ""),
  };
  return { ...actor, eligible: isEligible(actor) };
}

export const apifyStoreSearch: Tool<{ query: string; limit?: number }> = {
  name: "apify_store_search",
  description:
    "Free. Searches the Apify Store for ready-made scrapers (actors), most popular first. Use it to find an actor for a platform (e.g. 'tiktok profile', 'soundcloud', 'behance', 'indeed jobs', 'jobs.cz'). Only pick actors with eligible=true, prefer more users and a high success rate, then run one with apify_run_actor.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to scrape, e.g. 'soundcloud profile tracks'" },
      limit: { type: "number", description: "Max actors to return (default 8)" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  available: () => true,
  async run({ query, limit }) {
    const params = new URLSearchParams({ search: query, limit: String(Math.min(limit ?? 8, 20)), sortBy: "popularity" });
    const headers: Record<string, string> = config.APIFY_TOKEN ? { Authorization: `Bearer ${config.APIFY_TOKEN}` } : {};
    const res = await fetch(`https://api.apify.com/v2/store?${params}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Apify store HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { items?: StoreItem[] } };
    const actors = (body.data?.items ?? []).map(mapStoreItem);
    const text = actors
      .map((a) => `${a.id} | ${a.title} | users30d=${a.users30d} runs30d=${a.runs30d} success=${Math.round(a.successRate30d * 100)}% | ${a.pricingModel ?? "?"}${a.pricePerUnitUsd ? ` $${a.pricePerUnitUsd}/unit` : ""} | eligible=${a.eligible}\n  ${a.description}`)
      .join("\n");
    return { raw: actors, text: text || "No actors found.", usd: 0 };
  },
};

const FORBIDDEN_INPUT = /cookie|password|sessionid|session_id|login|token/i;

/** Rejects inputs that would log in as someone (cookies, passwords, session ids). We only read public data. */
export function assertPublicInput(input: unknown, path = "input"): void {
  if (!input || typeof input !== "object") return;
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_INPUT.test(k)) throw new Error(`Refused: ${path}.${k} looks like login data; only public data may be scraped`);
    assertPublicInput(v, `${path}.${k}`);
  }
}

// Server-side actor check: the model picks actors, so their eligibility is verified here, not trusted.
// ponytail: low bar so niche platforms (SoundCloud, Bandcamp) work; the per-run charge cap and item limit bound the risk
const MIN_USERS_30D = 10;
const MAX_CHARGE_PER_RUN_USD = 0.5;
const eligibility = new Map<string, { ok: boolean; reason?: string; at: number }>();

const allowed = (): Set<string> =>
  new Set(config.APIFY_ALLOWED_ACTORS.split(",").map((a) => a.trim().replace("~", "/")).filter(Boolean));

async function assertEligibleActor(actorId: string): Promise<void> {
  if (allowed().has(actorId.replace("~", "/"))) return;
  const hit = eligibility.get(actorId);
  if (hit && Date.now() - hit.at < 3_600_000) {
    if (!hit.ok) throw new Error(`Refused actor ${actorId}: ${hit.reason}`);
    return;
  }
  const actor = (await apify().actor(actorId.replace("/", "~")).get()) as
    | { isDeprecated?: boolean; stats?: { totalUsers30Days?: number }; isPublic?: boolean }
    | undefined;
  const users = actor?.stats?.totalUsers30Days ?? 0;
  const reason = !actor ? "not found" : actor.isDeprecated ? "deprecated" : users < MIN_USERS_30D ? `only ${users} users in 30 days` : undefined;
  eligibility.set(actorId, { ok: !reason, reason, at: Date.now() });
  if (reason) throw new Error(`Refused actor ${actorId}: ${reason}`);
}

type RunCost = {
  usageTotalUsd?: number;
  chargedEventCounts?: Record<string, number>;
  pricingInfo?: { pricingModel?: string; pricePerUnitUsd?: number; pricingPerEvent?: { actorChargeEvents?: Record<string, { eventPriceUsd?: number }> } };
  stats?: { itemsCount?: number };
};

/**
 * What a run really cost: platform usage plus pay-per-event or pay-per-result charges.
 * Null when Apify hasn't reported a cost yet, so the ledger keeps the reserved estimate instead of $0.
 */
export function runCostUsd(run: RunCost | undefined): number | null {
  if (!run || run.usageTotalUsd === undefined) return null;
  let usd = run.usageTotalUsd;
  const events = run.pricingInfo?.pricingPerEvent?.actorChargeEvents ?? {};
  for (const [event, count] of Object.entries(run.chargedEventCounts ?? {})) usd += (events[event]?.eventPriceUsd ?? 0) * count;
  if (run.pricingInfo?.pricingModel === "PRICE_PER_DATASET_ITEM") usd += (run.pricingInfo.pricePerUnitUsd ?? 0) * (run.stats?.itemsCount ?? 0);
  return usd;
}

/** Re-reads a finished run a few times until Apify has settled its billing. */
async function settledRun(runId: string): Promise<(RunCost & { status: string }) | undefined> {
  for (let i = 0; i < 3; i++) {
    const run = (await apify().run(runId).get().catch(() => undefined)) as (RunCost & { status: string }) | undefined;
    if (run && run.status !== "RUNNING" && run.usageTotalUsd !== undefined) return run;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return undefined;
}

let client: ApifyClient | null = null;
const apify = (): ApifyClient => (client ??= new ApifyClient({ token: config.APIFY_TOKEN }));

export const apifyRunActor: Tool<{ actorId: string; input: Record<string, unknown>; maxItems?: number }> = {
  name: "apify_run_actor",
  description:
    "Paid. Runs an Apify actor (id 'username/name' from apify_store_search) with the given input and returns its dataset items. Keep maxItems small (5–50) while exploring. Read the actor's description for its input fields (usually startUrls: [{url}], or usernames/profiles/queries, plus a max-results field). Never pass cookies or login data.",
  parameters: {
    type: "object",
    properties: {
      actorId: { type: "string", description: "Actor id like 'username/actor-name'" },
      input: { type: "object", description: "Actor input JSON", additionalProperties: true },
      maxItems: { type: "number", description: "Max dataset items to fetch and pay for (default 50, max 500)" },
    },
    required: ["actorId", "input"],
    additionalProperties: false,
  },
  paid: "apify",
  estimateUsd: MAX_CHARGE_PER_RUN_USD,
  available: () => !!config.APIFY_TOKEN,
  async run({ actorId, input, maxItems }) {
    if (!/^[\w.-]+[/~][\w.-]+$/.test(actorId)) throw new Error(`Invalid actor id "${actorId}"`);
    assertPublicInput(input);
    await assertEligibleActor(actorId);
    const limit = Math.min(Math.max(maxItems ?? 50, 1), 500);
    const started = await apify()
      .actor(actorId.replace("/", "~"))
      .call(input, { maxItems: limit, maxTotalChargeUsd: MAX_CHARGE_PER_RUN_USD, memory: 1024, timeout: 180, waitSecs: 200 });
    // From here on Apify bills us, so every exit reports the run's real (or unknown) cost.
    const final = await settledRun(started.id);
    const usd = runCostUsd((final ?? started) as RunCost);
    if ((final ?? started).status !== "SUCCEEDED") {
      if ((final ?? started).status === "RUNNING") await apify().run(started.id).abort().catch(() => undefined);
      throw new PaidToolError(`Actor run ${started.id} ended with status ${(final ?? started).status}`, usd);
    }
    let items: Record<string, unknown>[];
    try {
      ({ items } = await apify().dataset(started.defaultDatasetId).listItems({ limit }));
    } catch (err) {
      throw new PaidToolError(`Reading results of run ${started.id} failed: ${String(err)}`, usd);
    }
    const text = clip(items.map((i) => JSON.stringify(i)).join("\n"), 12_000);
    return { raw: items, text: `${items.length} items\n${text}`, usd: usd ?? MAX_CHARGE_PER_RUN_USD, usdKnown: usd !== null, units: items.length };
  },
};
