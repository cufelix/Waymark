import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Country, Occupation, Source, TaskCard } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";

export type DeckPath = { key: string; occupation: Occupation; kind: string };
export type DeckCard = TaskCard & { pathKey: string };
export type Deck = {
  country: Country;
  version: string;
  paths: DeckPath[];
  cards: DeckCard[];
};

const cache = new Map<Country, Deck>();

const invalid = (message: string): never => {
  throw new ApiError("internal", `Invalid intake deck: ${message}`);
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function exactKeys(value: Record<string, unknown>, path: string, required: string[], optional: string[] = []): void {
  for (const key of required) if (!(key in value)) invalid(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) invalid(`${path}.${key} is unknown`);
}

function validateOccupation(value: unknown, path: string): asserts value is Occupation {
  if (!isObject(value)) invalid(`${path} must be an object`);
  exactKeys(value, path, ["uri", "label", "lang"]);
  if (!nonEmpty(value.uri) || !nonEmpty(value.label) || !nonEmpty(value.lang)) invalid(`${path} must contain uri, label and lang`);
}

function validateSource(value: unknown, path: string): asserts value is Source {
  if (!isObject(value)) invalid(`${path} must be an object`);
  exactKeys(value, path, ["id", "url", "title", "fetchedAt", "tool", "quote", "contentHash"], ["snapshotKey"]);
  if (!nonEmpty(value.id)) invalid(`${path}.id must be non-empty`);
  if (!nonEmpty(value.url)) invalid(`${path}.url must be non-empty`);
  if (!nonEmpty(value.title)) invalid(`${path}.title must be non-empty`);
  if (!nonEmpty(value.fetchedAt)) invalid(`${path}.fetchedAt must be non-empty`);
  if (!nonEmpty(value.contentHash)) invalid(`${path}.contentHash must be non-empty`);
  if (!/^src_[0-9A-HJKMNP-TV-Z]{26}$/.test(value.id)) invalid(`${path}.id must be a src_ id`);
  try {
    const url = new URL(value.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") invalid(`${path}.url must be http(s)`);
  } catch {
    invalid(`${path}.url must be a valid URL`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.fetchedAt)) invalid(`${path}.fetchedAt must be ISO 8601 UTC`);
  if (value.tool !== "exa") invalid(`${path}.tool must be exa`);
  if (!nonEmpty(value.quote)) invalid(`${path}.quote must be non-empty`);
  if (!/^[0-9a-f]{64}$/.test(value.contentHash)) invalid(`${path}.contentHash must be a SHA-256 hex digest`);
  if (value.snapshotKey !== undefined && !nonEmpty(value.snapshotKey)) invalid(`${path}.snapshotKey must be non-empty when present`);
}

/** Validates the shape and internal references of a prebuilt, non-personal task deck. */
export function validateDeck(value: unknown): asserts value is Deck {
  if (!isObject(value)) invalid("root must be an object");
  exactKeys(value, "deck", ["country", "version", "paths", "cards"]);
  if (typeof value.country !== "string" || !/^[A-Z]{2}$/.test(value.country)) invalid("country must be an uppercase alpha-2 code");
  if (!nonEmpty(value.version)) invalid("version must be non-empty");
  if (!Array.isArray(value.paths) || value.paths.length === 0) invalid("paths must be a non-empty array");
  if (!Array.isArray(value.cards) || value.cards.length === 0) invalid("cards must be a non-empty array");

  const pathKeys = new Set<string>();
  const occupationUris = new Set<string>();
  const pathUriByKey = new Map<string, string>();
  value.paths.forEach((candidate, index) => {
    const path = `paths[${index}]`;
    if (!isObject(candidate)) invalid(`${path} must be an object`);
    exactKeys(candidate, path, ["key", "occupation", "kind"]);
    if (!nonEmpty(candidate.key) || pathKeys.has(candidate.key)) invalid(`${path}.key must be non-empty and unique`);
    if (!nonEmpty(candidate.kind)) invalid(`${path}.kind must be non-empty`);
    validateOccupation(candidate.occupation, `${path}.occupation`);
    pathKeys.add(candidate.key);
    occupationUris.add(candidate.occupation.uri);
    pathUriByKey.set(candidate.key, candidate.occupation.uri);
  });

  const cardIds = new Set<string>();
  value.cards.forEach((candidate, index) => {
    const path = `cards[${index}]`;
    if (!isObject(candidate)) invalid(`${path} must be an object`);
    exactKeys(candidate, path, ["cardId", "text", "occupation", "related", "source", "pathKey"]);
    if (!nonEmpty(candidate.cardId) || !/^crd_[0-9A-HJKMNP-TV-Z]{26}$/.test(candidate.cardId) || cardIds.has(candidate.cardId)) {
      invalid(`${path}.cardId must be a unique crd_ id`);
    }
    if (!nonEmpty(candidate.text)) invalid(`${path}.text must be non-empty`);
    if (!nonEmpty(candidate.pathKey) || !pathKeys.has(candidate.pathKey)) invalid(`${path}.pathKey must name a deck path`);
    validateOccupation(candidate.occupation, `${path}.occupation`);
    if (!occupationUris.has(candidate.occupation.uri)) invalid(`${path}.occupation must name a deck path occupation`);
    if (pathUriByKey.get(candidate.pathKey) !== candidate.occupation.uri) invalid(`${path}.occupation must match pathKey`);
    if (!Array.isArray(candidate.related)) invalid(`${path}.related must be an array`);
    candidate.related.forEach((related, relatedIndex) => {
      const relatedPath = `${path}.related[${relatedIndex}]`;
      if (!isObject(related)) invalid(`${relatedPath} must be an object`);
      exactKeys(related, relatedPath, ["occupation", "weight"]);
      validateOccupation(related.occupation, `${relatedPath}.occupation`);
      if (!occupationUris.has(related.occupation.uri)) invalid(`${relatedPath}.occupation must name a deck path occupation`);
      if (typeof related.weight !== "number" || !Number.isFinite(related.weight) || related.weight < 0 || related.weight > 1) {
        invalid(`${relatedPath}.weight must be between 0 and 1`);
      }
    });
    validateSource(candidate.source, `${path}.source`);
    cardIds.add(candidate.cardId);
  });
}

/** Loads and caches the prebuilt deck for an ISO alpha-2 country code. */
export function loadDeck(country: Country): Deck {
  const normalized = country.toUpperCase();
  const cached = cache.get(normalized);
  if (cached) return cached;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(import.meta.dirname, "decks", `${normalized.toLowerCase()}.json`), "utf8"));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("internal", `Intake deck for ${normalized} could not be loaded`);
  }
  validateDeck(parsed);
  if (parsed.country !== normalized) invalid(`country must be ${normalized}`);
  cache.set(normalized, parsed);
  return parsed;
}
