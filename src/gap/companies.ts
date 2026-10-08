import type { Company, CompanyCheck, SeekerProfile, SeekerResearch, Vacancy } from "./contracts.ts";

// "Analyze the company requirements": per company, the skills its ads ask for, with the seeker's evidence.
// Owner: worker evidence (uses evidenceFor from evidence.ts). Pure function, no I/O.
export function buildCompanyChecks(_input: {
  vacancies: Vacancy[];
  companies: Company[];
  profile: SeekerProfile;
  research: SeekerResearch;
}): CompanyCheck[] {
  throw new Error("not implemented");
}
