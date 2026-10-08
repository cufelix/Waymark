import type { CareerPath, JobMarket, JobProfile, Occupation, OccupationTrends, Vacancy } from "./contracts.ts";

// "Generalize job descriptions across markets": the typical job for one occupation across the seeker's locations.
// Owner: worker job-profile. Pure function, no I/O.
export function buildJobProfile(_input: {
  occupation: Occupation;
  vacancies: Vacancy[]; // only this occupation's vacancies
  market: JobMarket[]; // this occupation, one per location
  trends?: OccupationTrends;
  careerPath?: CareerPath; // for the ladder
}): JobProfile {
  throw new Error("not implemented");
}
