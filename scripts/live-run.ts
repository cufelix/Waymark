// Runs one real research run in this process and prints a summary. Spends real money (cost caps still apply).
//   pnpm exec tsx scripts/live-run.ts [profile.json] [--user-only]
// --user-only passes options.sources = [], so market research has no paid source to call.
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const { SeekerProfile } = await import("../src/contracts");
const { migrate } = await import("../src/db/migrate");
const { pool, query } = await import("../src/db/pool");
const { getRun, processRun, startRun, stopBoss } = await import("../src/research/run");

const args = process.argv.slice(2);
const userOnly = args.includes("--user-only");
const path = args.find((a) => !a.startsWith("--")) ?? "test/api/fixtures/junior-backend.json";
const profile = SeekerProfile.parse(JSON.parse(readFileSync(path, "utf8")));
const out = (line: string): void => void process.stdout.write(line + "\n");

await migrate();
const runId = await startRun(profile, userOnly ? { sources: [] } : {});
out(`run ${runId} for ${profile.seekerId} (${path}${userOnly ? ", user research only" : ""})`);

const ticker = setInterval(async () => {
  const run = await getRun(runId);
  if (run) out(`  ${run.status}  ${run.progress.map((p) => `${p.step} ${p.done}/${p.total}`).join(" · ")}`);
}, 3000);
await processRun(runId);
clearInterval(ticker);

const run = await getRun(runId);
if (!run) throw new Error(`run ${runId} disappeared`);
out(`\nstatus: ${run.status}${run.error ? `  (${run.error.code}: ${run.error.message})` : ""}`);
const r = run.result;
if (r) {
  out(`career paths: ${r.careerPaths.map((c) => `${c.occupation.label} (${c.vacancyCount})`).join(", ") || "none"}`);
  out(`companies: ${r.companyIds.length}  vacancies: ${r.vacancyIds.length}  markets: ${r.market.length}`);
  for (const l of r.seekerResearch.links) {
    const url = profile.links.find((x) => x.id === l.linkId)?.url ?? l.linkId;
    out(`  ${l.status.padEnd(11)} ${l.platform.padEnd(10)} ${l.ownership.padEnd(11)} skills ${l.provenSkills.length}  ${url}${l.reason ? `  — ${l.reason}` : ""}`);
  }
}
const [total] = await query<{ usd: string | null }>("SELECT sum(usd) AS usd FROM cost_ledger WHERE run_id = $1", [runId]);
out(`cost: ${run.cost.map((c) => `${c.tool} $${c.usd.toFixed(4)}`).join(", ") || "none"}  total $${Number(total?.usd ?? 0).toFixed(4)}`);

await stopBoss();
await pool.end();
