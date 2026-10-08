import assert from "node:assert/strict";
import test from "node:test";
import type { Company } from "./contracts.ts";
import { buildCompanyChecks } from "./companies.ts";
import { COMPANIES, PROFILE, SEEKER_RESEARCH, VACANCIES } from "./testdata/run.ts";

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

test("buildCompanyChecks puts dream companies first and describes each advertised requirement", () => {
  const checks = buildCompanyChecks({ vacancies: VACANCIES, companies: COMPANIES, profile: PROFILE, research: SEEKER_RESEARCH });

  assert.deepEqual(checks.map((check) => check.name), ["Example Dream s.r.o.", "Other Example a.s."]);
  assert.deepEqual(checks[0]!.vacancyIds, ["vac_1", "vac_2"]);
  assert.deepEqual(checks[0]!.requirements.map((requirement) => ({
    label: requirement.skill.label,
    required: requirement.required,
    evidence: requirement.evidence,
    quote: requirement.source.quote,
  })), [
    { label: "Docker", required: true, evidence: "proven", quote: "You know Docker." },
    { label: "PostgreSQL", required: true, evidence: "stated", quote: "Experience with PostgreSQL." },
    { label: "Kubernetes", required: false, evidence: "none", quote: "Kubernetes is a plus." },
  ]);
});

test("buildCompanyChecks upgrades a repeated skill to required while retaining its first ad quote", () => {
  const checks = buildCompanyChecks({
    vacancies: [
      { ...VACANCIES[3]!, companyId: "cmp_dream" },
      VACANCIES[0]!,
    ],
    companies: COMPANIES,
    profile: PROFILE,
    research: SEEKER_RESEARCH,
  });
  const docker = checks[0]!.requirements.find((requirement) => requirement.skill.label === "Docker")!;

  assert.equal(docker.required, true);
  assert.equal(docker.source.quote, "Docker is nice to have.");
});

test("buildCompanyChecks omits companies without vacancies and breaks non-dream ties by name", () => {
  const absent: Company = { ...COMPANIES[0]!, id: "cmp_absent", name: "Absent Dream", isDreamCompany: true };
  const otherDreamStatus = COMPANIES.map((company) => ({ ...company, isDreamCompany: false }));
  const checks = buildCompanyChecks({
    vacancies: [VACANCIES[2]!, VACANCIES[0]!],
    companies: [absent, ...otherDreamStatus],
    profile: PROFILE,
    research: SEEKER_RESEARCH,
  });

  assert.deepEqual(checks.map((check) => check.name), ["Example Dream s.r.o.", "Other Example a.s."]);
});

test("company checks contain no field that scores or totals the seeker's skills", () => {
  const checks = buildCompanyChecks({ vacancies: VACANCIES, companies: COMPANIES, profile: PROFILE, research: SEEKER_RESEARCH });
  const keys = collectKeys(checks);

  for (const forbidden of ["matchedSkills", "skillsMatched", "skillsTotal", "matchPercentage", "score", "rank", "probability"]) {
    assert.equal(keys.has(forbidden), false, `unexpected seeker summary field: ${forbidden}`);
  }
});
