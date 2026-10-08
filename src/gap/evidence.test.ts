import assert from "node:assert/strict";
import test from "node:test";
import type { Claim, SeekerProfile, SeekerResearch, Skill, Vacancy } from "./contracts.ts";
import { buildSkillChecks, evidenceFor, sameSkill, skillKey } from "./evidence.ts";
import { COMPANIES, DOCKER, K8S, POSTGRES, PROFILE, SEEKER_RESEARCH, TRENDS, VACANCIES } from "./testdata/run.ts";

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

test("skillKey keeps ESCO URIs and normalizes all other skills by label", () => {
  assert.equal(skillKey(DOCKER), DOCKER.uri);
  assert.equal(skillKey({ uri: "urn:stub:skill:cafe-c", label: " Café & C++ ", lang: "en" }), "label:cafe-c");
});

test("sameSkill matches equal URIs or normalized labels", () => {
  assert.equal(sameSkill(POSTGRES, { uri: "urn:stub:skill:postgres", label: "PóstgreSQL", lang: "en" }), true);
  assert.equal(sameSkill(DOCKER, { ...DOCKER, label: "containers" }), true);
  assert.equal(sameSkill(DOCKER, K8S), false);
});

test("evidenceFor distinguishes confirmed proof, profile statements, and unconfirmed links", () => {
  assert.deepEqual(evidenceFor(DOCKER, PROFILE, SEEKER_RESEARCH), {
    evidence: "proven",
    claims: [SEEKER_RESEARCH.links[0]!.provenSkills[0]!],
  });
  assert.deepEqual(evidenceFor(POSTGRES, PROFILE, SEEKER_RESEARCH), {
    evidence: "stated",
    claims: [PROFILE.statedSkills[0]!],
  });
  assert.deepEqual(evidenceFor(K8S, PROFILE, SEEKER_RESEARCH), { evidence: "none", claims: [] });
});

test("evidenceFor includes document statements once and puts proven claims first", () => {
  const statement = PROFILE.statedSkills[0]!;
  const proof = SEEKER_RESEARCH.links[0]!.provenSkills[0]!;
  const profile: SeekerProfile = {
    ...PROFILE,
    statedSkills: [statement],
    documents: [{ id: "doc_1", kind: "cv", fileName: "cv.pdf", uploadedAt: PROFILE.updatedAt, statedSkills: [statement], experience: [], education: [] }],
  };
  const proofForPostgres: Claim = { ...proof, id: "clm_proven_pg", skill: POSTGRES, statement: "Public PostgreSQL project" };
  const research: SeekerResearch = {
    links: [{ ...SEEKER_RESEARCH.links[0]!, provenSkills: [proofForPostgres] }],
  };

  assert.deepEqual(evidenceFor(POSTGRES, profile, research), {
    evidence: "proven",
    claims: [proofForPostgres, statement],
  });
});

test("evidenceFor only keeps non-proven link claims when their tier is stated", () => {
  const claimed: Claim = {
    ...SEEKER_RESEARCH.links[1]!.provenSkills[0]!,
    id: "clm_unconfirmed_stated",
    tier: "stated",
  };
  const research: SeekerResearch = { links: [{ ...SEEKER_RESEARCH.links[1]!, provenSkills: [claimed] }] };

  assert.deepEqual(evidenceFor(K8S, PROFILE, research), { evidence: "none", claims: [claimed] });
});

test("buildSkillChecks reports sourced employer demand and orders it independently of evidence", () => {
  const checks = buildSkillChecks({ vacancies: VACANCIES, companies: COMPANIES, profile: PROFILE, research: SEEKER_RESEARCH, trends: TRENDS });

  assert.deepEqual(checks.map((check) => check.skill.label), ["Docker", "PostgreSQL", "Kubernetes"]);
  assert.deepEqual(checks.map((check) => check.evidence), ["proven", "stated", "none"]);
  assert.deepEqual(checks[0]!.demand, {
    vacanciesRequiring: 3,
    vacanciesTotal: 4,
    companiesRequiring: 2,
    companiesTotal: 2,
    requiredIn: 2,
    sources: [VACANCIES[0]!.requirements[0]!.source, VACANCIES[1]!.requirements[0]!.source, VACANCIES[3]!.requirements[0]!.source],
  });
  assert.equal(checks[0]!.trend, "stable");
  assert.equal(checks[2]!.trend, "rising");
});

test("buildSkillChecks combines label-equivalent requirements and deduplicates repeated ad quotes", () => {
  const alias: Skill = { uri: "urn:stub:skill:docker", label: "Döcker", lang: "en" };
  const vacancy: Vacancy = {
    ...VACANCIES[0]!,
    requirements: [
      VACANCIES[0]!.requirements[0]!,
      { ...VACANCIES[0]!.requirements[0]!, skill: alias },
    ],
  };
  const checks = buildSkillChecks({ vacancies: [vacancy], companies: COMPANIES, profile: PROFILE, research: SEEKER_RESEARCH });

  assert.equal(checks.length, 1);
  assert.equal(checks[0]!.demand.vacanciesRequiring, 1);
  assert.equal(checks[0]!.demand.requiredIn, 2);
  assert.equal(checks[0]!.demand.sources.length, 1);
});

test("skill checks contain no field that scores or totals the seeker's skills", () => {
  const checks = buildSkillChecks({ vacancies: VACANCIES, companies: COMPANIES, profile: PROFILE, research: SEEKER_RESEARCH, trends: TRENDS });
  const keys = collectKeys(checks);

  for (const forbidden of ["matchedSkills", "skillsMatched", "skillsTotal", "matchPercentage", "score", "rank", "probability"]) {
    assert.equal(keys.has(forbidden), false, `unexpected seeker summary field: ${forbidden}`);
  }
});
