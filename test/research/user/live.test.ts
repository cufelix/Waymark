// Live check against real services. Run with: LIVE=1 pnpm exec vitest run test/research/user/live.test.ts
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.LIVE)("readInput live", () => {
  it("learns a recipe for a GitHub profile, then replays it for another user, and reads a plain website", async () => {
    process.loadEnvFile(".env");
    const { query, pool } = await import("../../../src/db/pool");
    const { readInput } = await import("../../../src/research/user/reader");
    await query("DELETE FROM recipes WHERE key IN ('url:github.com/{seg1}', 'url:danluu.com')");
    const at = "2026-10-08T00:00:00Z";

    const first = await readInput({ id: "lnk_live1", url: "https://github.com/torvalds", addedAt: at }, undefined);
    const [recipe] = await query("SELECT key, steps, expected_shape FROM recipes WHERE key = 'url:github.com/{seg1}'");
    const second = await readInput({ id: "lnk_live2", url: "https://github.com/gvanrossum", addedAt: at }, undefined);
    const site = await readInput({ id: "lnk_live3", url: "https://danluu.com", addedAt: at }, undefined);

    process.stdout.write(JSON.stringify({
      first: { status: first.status, learned: first.learned, usd: first.usd, owner: first.artifact.owner?.handle, items: first.artifact.items.length },
      recipe,
      second: { status: second.status, learned: second.learned, usd: second.usd, owner: second.artifact.owner?.handle, items: second.artifact.items.length },
      site: { status: site.status, learned: site.learned, usd: site.usd, extractor: site.artifact.extractor, chars: site.artifact.text.length },
    }, null, 2) + "\n");

    expect(first.status).not.toBe("failed");
    expect(second.learned).toBe(false); // replayed the recipe, no agent
    expect(site.artifact.text.length).toBeGreaterThan(200);
    await pool.end();
  }, 300_000);
});
