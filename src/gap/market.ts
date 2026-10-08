import { createHash } from "node:crypto";
import type { JobMarket, MarketFacts, Source, Vacancy } from "./contracts.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const OPEN_WINDOW_MS = 14 * DAY_MS;

// Text is stripped of combining marks before matching, so the Czech alternatives
// below intentionally use their ASCII forms.
const ENTRY_LEVEL_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:junior|trainee|intern|internship|graduate|entry level|entry-level|no experience|without experience|absolvent|staz|stazista|praktikant|bez praxe|bez zkusenosti|zacinajici|berufseinsteiger|einsteiger|praktikum|ohne berufserfahrung)(?=$|[^\p{L}\p{N}])/u;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normaliseForEntryLevelMatch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

function mentionsEntryLevel(value: string | undefined): boolean {
  return value !== undefined && ENTRY_LEVEL_PATTERN.test(normaliseForEntryLevelMatch(value));
}

function sameCountry(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

function sameCity(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function vacancyIsInLocation(vacancy: Vacancy, location: { country: string; city?: string }): boolean {
  if (!sameCountry(vacancy.location.country, location.country)) return false;
  if (location.city === undefined || vacancy.location.remote) return true;
  return vacancy.location.city !== undefined && sameCity(vacancy.location.city, location.city);
}

function marketIsForLocation(item: JobMarket, location: { country: string; city?: string }): boolean {
  if (!sameCountry(item.location.country, location.country)) return false;
  if (location.city === undefined) return item.location.city === undefined;
  return item.location.city !== undefined && sameCity(item.location.city, location.city);
}

function titleSource(vacancy: Vacancy): Source {
  return {
    id: `src_${sha256(`${vacancy.canonicalUrl}\0${vacancy.title}`)}`,
    url: vacancy.canonicalUrl,
    title: vacancy.title,
    fetchedAt: vacancy.firstSeenAt,
    tool: "apify",
    quote: vacancy.title,
    contentHash: sha256(vacancy.title),
  };
}

function entryLevelSource(vacancy: Vacancy): Source | undefined {
  if (mentionsEntryLevel(vacancy.title)) return titleSource(vacancy);
  return vacancy.requirements.find(({ source }) => mentionsEntryLevel(source.quote))?.source;
}

function medianDaysOpen(vacancies: Vacancy[]): number | undefined {
  if (vacancies.length === 0) return undefined;

  const days = vacancies
    .map(({ firstSeenAt, lastSeenAt }) => Math.floor((Date.parse(lastSeenAt) - Date.parse(firstSeenAt)) / DAY_MS))
    .sort((left, right) => left - right);
  const middle = Math.floor(days.length / 2);
  if (days.length % 2 === 1) return days[middle];
  return (days[middle - 1]! + days[middle]!) / 2;
}

// "Analyze chances to get each position" as market facts, never a probability for the seeker.
// Owner: worker market. Pure function, no I/O.
export function buildMarketFacts(input: {
  vacancies: Vacancy[]; // only this occupation's vacancies
  market: JobMarket[]; // this occupation, one per location
  locations: { country: string; city?: string }[];
  now?: Date; // for tests
}): MarketFacts[] {
  const nowMs = (input.now ?? new Date()).getTime();

  return input.locations.map((location) => {
    const vacancies = input.vacancies.filter((vacancy) => vacancyIsInLocation(vacancy, location));
    const entryLevelSources = vacancies.map(entryLevelSource).filter((source): source is Source => source !== undefined);
    const salaryRange = input.market.find((item) => marketIsForLocation(item, location))?.salaryRange;
    const median = medianDaysOpen(vacancies);

    return {
      location: { ...location },
      openVacancies: vacancies.filter((vacancy) => {
        const age = nowMs - Date.parse(vacancy.lastSeenAt);
        return age >= 0 && age <= OPEN_WINDOW_MS;
      }).length,
      entryLevelVacancies: entryLevelSources.length,
      entryLevelSources,
      ...(median === undefined ? {} : { medianDaysOpen: median }),
      repostedVacancies: vacancies.filter((vacancy) => vacancy.repostCount >= 1).length,
      ...(salaryRange === undefined ? {} : { salaryRange }),
    };
  });
}
