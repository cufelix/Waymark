import type { JobMarket, MarketFacts, Vacancy } from "./contracts.ts";

// "Analyze chances to get each position" as market facts, never a probability for the seeker.
// Owner: worker market. Pure function, no I/O.
export function buildMarketFacts(_input: {
  vacancies: Vacancy[]; // only this occupation's vacancies
  market: JobMarket[]; // this occupation, one per location
  locations: { country: string; city?: string }[];
  now?: Date; // for tests
}): MarketFacts[] {
  throw new Error("not implemented");
}
