import type { CareerPath, JobMarket, JobProfile, Occupation, OccupationTrends, Skill, Source, Vacancy } from "./contracts.ts";
import { canonicalSkillKey, escoKeysByLabel, sameSkill, skillKey } from "./evidence.ts";

function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.url}\u0000${source.quote ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "Generalize job descriptions across markets": the typical job for one occupation across the seeker's locations.
// Owner: worker job-profile. Pure function, no I/O.
export function buildJobProfile(input: {
  occupation: Occupation;
  vacancies: Vacancy[]; // only this occupation's vacancies
  market: JobMarket[]; // this occupation, one per location
  trends?: OccupationTrends;
  careerPath?: CareerPath; // for the ladder
}): JobProfile {
  const markets = new Map<string, JobProfile["markets"][number]>();
  const allSkills = input.vacancies.flatMap((vacancy) => vacancy.requirements.map((requirement) => requirement.skill));
  const escoIndex = escoKeysByLabel(allSkills);
  const canonicalSkills = new Map<string, Skill>();
  for (const skill of [...allSkills].sort((left, right) => {
    const leftKey = canonicalSkillKey(left, escoIndex);
    const rightKey = canonicalSkillKey(right, escoIndex);
    return leftKey.localeCompare(rightKey)
      || Number(skillKey(right) === rightKey) - Number(skillKey(left) === leftKey)
      || left.uri.localeCompare(right.uri)
      || left.label.localeCompare(right.label);
  })) {
    const key = canonicalSkillKey(skill, escoIndex);
    if (!canonicalSkills.has(key)) canonicalSkills.set(key, skill);
  }
  const skillGroups = new Map<string, { skill: Skill; vacancyIds: Set<string>; sources: Source[] }>();

  for (const vacancy of input.vacancies) {
    const marketKey = `${vacancy.location.country}\u0000${vacancy.location.city ?? ""}`;
    const existingMarket = markets.get(marketKey);
    if (existingMarket) existingMarket.vacancies += 1;
    else {
      markets.set(marketKey, {
        country: vacancy.location.country,
        ...(vacancy.location.city === undefined ? {} : { city: vacancy.location.city }),
        vacancies: 1,
      });
    }

    for (const requirement of vacancy.requirements) {
      const key = canonicalSkillKey(requirement.skill, escoIndex);
      let group = skillGroups.get(key);
      if (!group) {
        group = { skill: canonicalSkills.get(key)!, vacancyIds: new Set<string>(), sources: [] };
        skillGroups.set(key, group);
      }
      group.vacancyIds.add(vacancy.id);
      group.sources.push(requirement.source);
    }
  }

  const vacanciesTotal = input.vacancies.length;
  const skills: JobProfile["skills"] = [...skillGroups.values()].map((group) => {
    const vacanciesRequiring = group.vacancyIds.size;
    const share = vacanciesTotal === 0 ? 0 : vacanciesRequiring / vacanciesTotal;
    const trend = input.trends?.skills.find(({ skill }) => sameSkill(skill, group.skill));

    return {
      skill: group.skill,
      vacanciesRequiring,
      vacanciesTotal,
      band: share >= 0.5 ? "most" : share >= 0.2 ? "many" : "some",
      ...(trend === undefined ? {} : { trend: trend.trend, trendSources: trend.sources }),
      sources: uniqueSources(group.sources),
    };
  });
  skills.sort((left, right) => right.vacanciesRequiring - left.vacanciesRequiring || left.skill.label.localeCompare(right.skill.label));

  const salaryRange = input.market
    .flatMap((market) => (market.salaryRange === undefined ? [] : [market.salaryRange]))
    .reduce<JobProfile["salaryRange"]>((selected, candidate) =>
      selected === undefined || candidate.sampleSize > selected.sampleSize ? candidate : selected, undefined);

  return {
    occupation: input.occupation,
    vacanciesAnalysed: vacanciesTotal,
    markets: [...markets.values()],
    skills,
    ...(salaryRange === undefined ? {} : { salaryRange }),
    ...(input.careerPath?.ladder === undefined ? {} : { ladder: input.careerPath.ladder }),
  };
}
