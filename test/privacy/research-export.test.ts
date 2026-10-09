import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool";
import { deleteResearchForSeeker, listRunsForSeeker } from "../../src/research/gdpr";
import { PROFILE } from "../../src/roadmap/testdata/validation";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const seekerId = `skr_export_${suffix}`;
const runId = `run_export_${suffix}`;
const artifactId = `art_export_${suffix}`;

afterAll(async () => {
  await pool.query("DELETE FROM research_runs WHERE id = $1", [runId]);
});

describe("complete research export and deletion", () => {
  it("exports stored inputs, artifact data and exact ledger rows, then cascades the ledger", async () => {
    const profile = { ...structuredClone(PROFILE), seekerId };
    const options = { sources: ["exa"], nameSearch: false };
    await pool.query(
      `INSERT INTO research_runs
         (id, seeker_id, profile_version, profile, options, status, progress, result, finished_at, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'done', '[]', $6::jsonb, now(), now() + interval '90 days')`,
      [runId, seekerId, profile.profileVersion, JSON.stringify(profile), JSON.stringify(options), JSON.stringify({ careerPaths: [], trends: [], companyIds: [], vacancyIds: [], market: [], seekerResearch: { links: [] } })],
    );
    await pool.query(
      "INSERT INTO artifacts (id, run_id, seeker_id, input_id, data) VALUES ($1, $2, $3, $4, $5::jsonb)",
      [artifactId, runId, seekerId, "lnk_example", JSON.stringify({ extractedText: "Example portfolio text" })],
    );
    await pool.query(
      "INSERT INTO cost_ledger (tool, units, usd, run_id, detail) VALUES ('exa', 2, 0.004, $1, 'two pages')",
      [runId],
    );

    const exported = await listRunsForSeeker(seekerId);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.runId).toBe(runId);
    expect(exported[0]?.storedInput.profile.seekerId).toBe(seekerId);
    expect(exported[0]?.storedInput.options).toMatchObject(options);
    expect(exported[0]?.artifacts[0]).toMatchObject({ artifactId, inputId: "lnk_example", data: { extractedText: "Example portfolio text" } });
    expect(exported[0]?.costLedger[0]).toMatchObject({ tool: "exa", units: 2, usd: 0.004, detail: "two pages" });

    expect(await deleteResearchForSeeker(seekerId)).toBe(1);
    expect((await pool.query("SELECT 1 FROM cost_ledger WHERE run_id = $1", [runId])).rowCount).toBe(0);
  });
});
