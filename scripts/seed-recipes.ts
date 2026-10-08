// Pins the launch recipes from docs/user-research.md §1, so common inputs never need the agent.
// Idempotent: re-running overwrites the seeds and keeps them pinned. Run: pnpm exec tsx scripts/seed-recipes.ts
import { fileURLToPath } from "node:url";
import type { RecipeStep } from "../src/agent/recipes";

export type Seed = { key: string; steps: RecipeStep[]; expectedShape: string[]; note: string };

// Actor IDs and input fields checked against the Apify store and each actor's latest build input schema (2026-10-08).
// Left out on purpose: SoundCloud and Behance (no actor with real monthly usage); the agent learns those.
export const seeds: Seed[] = [
  {
    key: "url:github.com/{seg1}",
    note: "GitHub REST API: profile, then repositories by last push",
    steps: [
      { tool: "github_api", params: { path: "/users/{seg1}" } },
      { tool: "github_api", params: { path: "/users/{seg1}/repos?per_page=100&sort=pushed" } },
    ],
    expectedShape: ["description", "fork", "html_url", "language", "name", "pushed_at"],
  },
  {
    key: "url:tiktok.com/{seg1}",
    note: "clockworks/tiktok-profile-scraper (about 7,600 users a month)",
    steps: [
      {
        tool: "apify_run_actor",
        params: {
          actorId: "clockworks/tiktok-profile-scraper",
          input: { profiles: ["{handle}"], profileScrapeSections: ["videos"], resultsPerPage: 30 },
          maxItems: 30,
        },
      },
    ],
    expectedShape: ["authorMeta", "playCount", "text", "webVideoUrl"],
  },
  {
    key: "url:instagram.com/{seg1}",
    note: "apify/instagram-profile-scraper (about 32,000 users a month)",
    steps: [
      {
        tool: "apify_run_actor",
        params: { actorId: "apify/instagram-profile-scraper", input: { usernames: ["{handle}"] }, maxItems: 1 },
      },
    ],
    expectedShape: ["biography", "followersCount", "fullName", "latestPosts", "username"],
  },
  {
    key: "url:youtube.com/{seg1}",
    note: "streamers/youtube-channel-scraper (about 3,100 users a month)",
    steps: [
      {
        tool: "apify_run_actor",
        params: { actorId: "streamers/youtube-channel-scraper", input: { startUrls: [{ url: "{url}" }], maxResults: 30 }, maxItems: 30 },
      },
    ],
    expectedShape: ["channelName", "date", "title", "url", "viewCount"],
  },
];

async function main(): Promise<void> {
  const { query, pool } = await import("../src/db/pool");
  const { migrate } = await import("../src/db/migrate");
  await migrate();
  for (const s of seeds) {
    await query(
      `INSERT INTO recipes (key, steps, expected_shape, status) VALUES ($1, $2, $3, 'pinned')
       ON CONFLICT (key) DO UPDATE SET steps = EXCLUDED.steps, expected_shape = EXCLUDED.expected_shape,
         status = 'pinned', updated_at = now()`,
      [s.key, JSON.stringify(s.steps), JSON.stringify(s.expectedShape)],
    );
    process.stdout.write(`pinned ${s.key}  (${s.note})\n`);
  }
  await pool.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
