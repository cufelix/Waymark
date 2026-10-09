import type { Claim, Evidence, OccupationTrends, SeekerProfile, SeekerResearch, Skill, SkillCheck, Company, Vacancy } from "./contracts.ts";

// "Analyze user match %" without a number: per skill, employer demand next to the seeker's evidence.
// Owner: worker evidence. Pure functions, no I/O.

// Key used to compare skills: the ESCO URI, or slug(label) for stub URIs (see API.md "Matching skills").
export function skillKey(skill: Skill): string {
  if (skill.uri && !/^urn:stub:/i.test(skill.uri)) return skill.uri;
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
  if (a.uri && a.uri === b.uri) return true;
  const hasFallbackUri = (skill: Skill): boolean => !skill.uri || /^urn:stub:/i.test(skill.uri);
  return (hasFallbackUri(a) || hasFallbackUri(b)) && slug(a.label) === slug(b.label);
}

// Stub skills inherit a real ESCO key when their normalized label identifies one.
// Sorting makes the mapping deterministic even if malformed upstream data gives
// the same label to more than one ESCO URI.
export function escoKeysByLabel(skills: Skill[]): Map<string, string> {
  const index = new Map<string, string>();
  const escoSkills = skills
    .filter((skill) => /^https?:\/\/\S*esco\S*$/i.test(skill.uri))
    .sort((left, right) => left.uri.localeCompare(right.uri));
  for (const skill of escoSkills) {
    const labelKey = `label:${slug(skill.label)}`;
    if (!index.has(labelKey)) index.set(labelKey, skill.uri);
  }
  return index;
}

export function canonicalSkillKey(skill: Skill, escoIndex: ReadonlyMap<string, string>): string {
  const key = skillKey(skill);
  return key.startsWith("label:") ? escoIndex.get(key) ?? key : key;
}

function representativeSkill(skills: Skill[], key: string, escoIndex: ReadonlyMap<string, string>): Skill {
  return [...skills]
    .filter((skill) => canonicalSkillKey(skill, escoIndex) === key)
    .sort((left, right) => {
      const leftCanonical = Number(skillKey(left) === key);
      const rightCanonical = Number(skillKey(right) === key);
      return rightCanonical - leftCanonical
        || left.uri.localeCompare(right.uri)
        || left.label.localeCompare(right.label);
    })[0]!;
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
  const allSkills = input.vacancies.flatMap((vacancy) => vacancy.requirements.map((requirement) => requirement.skill));
  const escoIndex = escoKeysByLabel(allSkills);
  const skillGroups = new Map<string, Skill>();
  for (const skill of allSkills) {
    const key = canonicalSkillKey(skill, escoIndex);
    if (!skillGroups.has(key)) skillGroups.set(key, representativeSkill(allSkills, key, escoIndex));
  }

  const companiesTotal = new Set(input.vacancies.map((vacancy) => vacancy.companyId)).size;
  const checks = [...skillGroups].map(([key, skill]): SkillCheck => {
    const vacancies = input.vacancies.filter((vacancy) =>
      vacancy.requirements.some((requirement) => canonicalSkillKey(requirement.skill, escoIndex) === key),
    );
    const requirements = vacancies.flatMap((vacancy) => vacancy.requirements
      .filter((requirement) => canonicalSkillKey(requirement.skill, escoIndex) === key)
      .map((requirement) => ({ vacancyId: vacancy.id, ...requirement })));
    const sources = requirements.map((requirement) => requirement.source).filter((source, index, all) =>
      all.findIndex((candidate) => candidate.url === source.url && candidate.quote === source.quote) === index,
    );
    const evidence = evidenceFor(skill, input.profile, input.research);
    const trend = input.trends?.skills.find((candidate) => sameSkill(skill, candidate.skill));

    return {
      skill,
      demand: {
        vacanciesRequiring: new Set(vacancies.map((vacancy) => vacancy.id)).size,
        vacanciesTotal: input.vacancies.length,
        companiesRequiring: new Set(vacancies.map((vacancy) => vacancy.companyId)).size,
        companiesTotal,
        requiredIn: new Set(requirements.filter((requirement) => requirement.required).map((requirement) => requirement.vacancyId)).size,
        sources,
      },
      evidence: evidence.evidence,
      claims: evidence.claims,
      ...(trend ? { trend: trend.trend, trendSources: trend.sources } : {}),
    };
  });

  return checks.sort((a, b) =>
    b.demand.vacanciesRequiring - a.demand.vacanciesRequiring
    || b.demand.requiredIn - a.demand.requiredIn
    || a.skill.label.localeCompare(b.skill.label),
  );
}
