import type { Claim, Evidence, OccupationTrends, SeekerProfile, SeekerResearch, Skill, SkillCheck, Company, Vacancy } from "./contracts.ts";

// "Analyze user match %" without a number: per skill, employer demand next to the seeker's evidence.
// Owner: worker evidence. Pure functions, no I/O.

// Key used to compare skills: the ESCO URI, or slug(label) for stub URIs (see API.md "Matching skills").
export function skillKey(_skill: Skill): string {
  throw new Error("not implemented");
}

// The seeker's evidence for one skill: proven (confirmed-ownership link), stated (CV / interview), or none.
export function evidenceFor(_skill: Skill, _profile: SeekerProfile, _research: SeekerResearch): { evidence: Evidence; claims: Claim[] } {
  throw new Error("not implemented");
}

export function buildSkillChecks(_input: {
  vacancies: Vacancy[];
  companies: Company[];
  profile: SeekerProfile;
  research: SeekerResearch;
  trends?: OccupationTrends;
}): SkillCheck[] {
  throw new Error("not implemented");
}
