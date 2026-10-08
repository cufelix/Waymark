import type { Company, CompanyCheck, SeekerProfile, SeekerResearch, Vacancy } from "./contracts.ts";
import { canonicalSkillKey, escoKeysByLabel, evidenceFor } from "./evidence.ts";

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

    const escoIndex = escoKeysByLabel(vacancies.flatMap((vacancy) => vacancy.requirements.map((requirement) => requirement.skill)));
    const requirementKeys = new Map<string, CompanyCheck["requirements"][number]>();
    const requirements: CompanyCheck["requirements"] = [];
    for (const vacancy of vacancies) {
      for (const requirement of vacancy.requirements) {
        const key = canonicalSkillKey(requirement.skill, escoIndex);
        const existing = requirementKeys.get(key);
        if (existing) {
          if (!existing.required && requirement.required) {
            existing.required = true;
            existing.source = requirement.source;
          }
          continue;
        }
        const check = {
          skill: requirement.skill,
          required: requirement.required,
          evidence: evidenceFor(requirement.skill, input.profile, input.research).evidence,
          source: requirement.source,
        };
        requirements.push(check);
        requirementKeys.set(key, check);
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
