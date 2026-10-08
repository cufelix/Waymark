import type { CareerPath, Company, JobMarket, OccupationTrends, ResearchRunHead, SeekerResearch, Vacancy } from "./contracts.ts";

// Reads a finished run from Part 2 over HTTP (API.md "Part 2: Research"). null = 404.
// Owner: worker service.
export interface Part2Client {
  getRun(runId: string): Promise<ResearchRunHead | null>;
  getCareerPaths(runId: string): Promise<CareerPath[]>;
  getMarket(runId: string): Promise<JobMarket[]>;
  getTrends(runId: string): Promise<OccupationTrends[]>;
  getSeekerResearch(runId: string): Promise<SeekerResearch>;
  listCompanies(runId: string): Promise<Company[]>; // all pages
  listVacancies(runId: string, occupationUri: string): Promise<Vacancy[]>; // all pages, ?occupation=
}
