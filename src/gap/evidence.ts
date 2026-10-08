import type { Claim, Evidence, OccupationTrends, SeekerProfile, SeekerResearch, Skill, SkillCheck, Company, Vacancy } from "./contracts.ts";

// "Analyze user match %" without a number: per skill, employer demand next to the seeker's evidence.
// Owner: worker evidence. Pure functions, no I/O.

// Key used to compare skills: the ESCO URI, or slug(label) for stub URIs (see API.md "Matching skills").
export function skillKey(skill: Skill): string {
  if (/^https?:\/\/\S*esco\S*$/i.test(skill.uri)) return skill.uri;
  return `label:${slug(skill.label)}`;
}

function slug(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function sameSkill(a: Skill, b: Skill): boolean {
  return a.uri === b.uri || slug(a.label) === slug(b.label);
}

function uniqueClaims(claims: Claim[]): Claim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    if (seen.has(claim.id)) return false;
    seen.add(claim.id);
    return true;
  });
}

// The seeker's evidence for one skill: proven (confirmed-ownership link), stated (CV / interview), or none.
export function evidenceFor(skill: Skill, profile: SeekerProfile, research: SeekerResearch): { evidence: Evidence; claims: Claim[] } {
  const profileClaims = uniqueClaims([
    ...profile.statedSkills,
    ...profile.documents.flatMap((document) => document.statedSkills),
  ].filter((claim) => claim.skill !== undefined && sameSkill(skill, claim.skill)));

  const provenClaims: Claim[] = [];
  const linkStatedClaims: Claim[] = [];
  for (const link of research.links) {
    for (const claim of link.provenSkills) {
      if (!claim.skill || !sameSkill(skill, claim.skill)) continue;
      if (link.ownership === "confirmed" && link.reachable && claim.tier !== "stated" && claim.tier !== "contradicted") {
        provenClaims.push(claim);
      } else if (claim.tier === "stated") {
        linkStatedClaims.push(claim);
      }
    }
  }

  const proven = uniqueClaims(provenClaims);
  const claims = uniqueClaims([...proven, ...profileClaims, ...linkStatedClaims]);
  const evidence: Evidence = proven.length > 0 ? "proven" : profileClaims.length > 0 ? "stated" : "none";
  return { evidence, claims };
}

export function buildSkillChecks(input: {
  vacancies: Vacancy[];
  companies: Company[];
  profile: SeekerProfile;
  research: SeekerResearch;
  trends?: OccupationTrends;
}): SkillCheck[] {
  const skills: Skill[] = [];
  for (const vacancy of input.vacancies) {
    for (const requirement of vacancy.requirements) {
      if (!skills.some((skill) => sameSkill(skill, requirement.skill))) skills.push(requirement.skill);
    }
  }

  const companiesTotal = new Set(input.vacancies.map((vacancy) => vacancy.companyId)).size;
  const checks = skills.map((skill): SkillCheck => {
    const vacancies = input.vacancies.filter((vacancy) =>
      vacancy.requirements.some((requirement) => sameSkill(skill, requirement.skill)),
    );
    const requirements = vacancies.flatMap((vacancy) =>
      vacancy.requirements.filter((requirement) => sameSkill(skill, requirement.skill)),
    );
    const sources = requirements.map((requirement) => requirement.source).filter((source, index, all) =>
      all.findIndex((candidate) => candidate.url === source.url && candidate.quote === source.quote) === index,
    );
    const evidence = evidenceFor(skill, input.profile, input.research);
    const trend = input.trends?.skills.find((candidate) => sameSkill(skill, candidate.skill))?.trend;

    return {
      skill,
      demand: {
        vacanciesRequiring: vacancies.length,
        vacanciesTotal: input.vacancies.length,
        companiesRequiring: new Set(vacancies.map((vacancy) => vacancy.companyId)).size,
        companiesTotal,
        requiredIn: requirements.filter((requirement) => requirement.required).length,
        sources,
      },
      evidence: evidence.evidence,
      claims: evidence.claims,
      ...(trend ? { trend } : {}),
    };
  });

  return checks.sort((a, b) =>
    b.demand.vacanciesRequiring - a.demand.vacanciesRequiring
    || b.demand.requiredIn - a.demand.requiredIn
    || a.skill.label.localeCompare(b.skill.label),
  );
}
