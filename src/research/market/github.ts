// Cached, rate-limited GitHub API reads for role-model research. Public data only; responses are shared across
// runs for 24 h, so repeated research is fast and stays under GitHub's limits (60/h without a token, 5,000 with).
import { config } from "../../config";
import { query } from "../../db/pool";
import { log } from "../../log";

const TTL_HOURS = 24;
const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

let rateLimitedUntil = 0;

/** GET a GitHub API path (e.g. "/orgs/google/public_members"). Returns null on 404, rate limits or errors. */
export async function gh<T>(path: string): Promise<T | null> {
  const [hit] = await query<{ status: number; body: T }>(
    `SELECT status, body FROM github_cache WHERE path = $1 AND fetched_at > now() - interval '${TTL_HOURS} hours'`,
    [path],
  );
  if (hit) return hit.status === 200 ? hit.body : null;
  if (Date.now() < rateLimitedUntil) return null;

  return slot(async () => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "EtheraResearchBot/0.1 (+https://github.com/cufelix/ethera-hack)",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(config.GITHUB_TOKEN ? { Authorization: `Bearer ${config.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res) return null;
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
      rateLimitedUntil = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      log.warn("github rate limit reached", { resetAt: new Date(rateLimitedUntil).toISOString(), token: !!config.GITHUB_TOKEN });
      return null;
    }
    const body = res.ok ? ((await res.json()) as T) : null;
    // Cache successes and 404s (an org that doesn't exist stays absent for a day); not transient errors.
    if (res.ok || res.status === 404) {
      await query(
        "INSERT INTO github_cache (path, status, body) VALUES ($1, $2, $3) ON CONFLICT (path) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body, fetched_at = now()",
        [path, res.status, body === null ? null : JSON.stringify(body)],
      );
    }
    return body;
  });
}

/** Runs fn over items with at most `limit` at a time, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}
