import type { Company, CompanyCheck, SeekerProfile, SeekerResearch, Vacancy } from "./contracts.ts";
import { evidenceFor, sameSkill } from "./evidence.ts";

// "Analyze the company requirements": per company, the skills its ads ask for, with the seeker's evidence.
// Owner: worker evidence (uses evidenceFor from evidence.ts). Pure function, no I/O.
export function buildCompanyChecks(input: {
  vacancies: Vacancy[];
  companies: Company[];
  profile: SeekerProfile;
  research: SeekerResearch;
}): CompanyCheck[] {
  const checks = input.companies.flatMap((company): CompanyCheck[] => {
    const vacancies = input.vacancies.filter((vacancy) => vacancy.companyId === company.id);
    if (vacancies.length === 0) return [];

    const requirements: CompanyCheck["requirements"] = [];
    for (const vacancy of vacancies) {
      for (const requirement of vacancy.requirements) {
        const existing = requirements.find((candidate) => sameSkill(candidate.skill, requirement.skill));
        if (existing) {
          existing.required ||= requirement.required;
          continue;
        }
        requirements.push({
          skill: requirement.skill,
          required: requirement.required,
          evidence: evidenceFor(requirement.skill, input.profile, input.research).evidence,
          source: requirement.source,
        });
      }
    }

    return [{
      companyId: company.id,
      name: company.name,
      isDreamCompany: company.isDreamCompany,
      vacancyIds: [...new Set(vacancies.map((vacancy) => vacancy.id))],
      requirements,
    }];
  });

  return checks.sort((a, b) =>
    Number(b.isDreamCompany) - Number(a.isDreamCompany)
    || b.vacancyIds.length - a.vacancyIds.length
    || a.name.localeCompare(b.name),
  );
}
