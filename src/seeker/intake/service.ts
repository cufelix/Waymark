import { isDeepStrictEqual } from "node:util";
import type { CareerPreferences, Intake, IntakePractical } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";
import { touch } from "../core/profile.ts";
import { validatePreferences } from "../core/validate.ts";
import type { LlmClient } from "../llm/llm.ts";
import { loadSeeker, updateSeeker } from "../service/seekers.ts";
import type { SeekerRecord, SeekerStore } from "../store/store.ts";
import { warmupFreeText as runWarmupFreeText, type WarmupReply } from "./chat.ts";
import type { Deck } from "./deck.ts";
import * as defaultEngine from "./engine.ts";
import type { CardRating, IntakeState } from "./engine.ts";
import { GOAL_BY_OPTION } from "./warmup.ts";

export type IntakeEngine = Pick<
  typeof defaultEngine,
  "newIntakeState" | "applyWarmup" | "applyRating" | "addMoreCards" | "toPublic"
>;

export type IntakeDeps = {
  store: SeekerStore;
  llm: LlmClient;
  loadDeck: (country: string) => Deck;
  engine?: IntakeEngine;
  warmupFreeText?: (deps: IntakeDeps, seekerId: string, question: Intake["warmup"]["questions"][number], answer: string) => Promise<WarmupReply>;
};

export type IntakeViewDeps = Pick<IntakeDeps, "loadDeck" | "engine">;

type WarmupBody = { questionKey: string; answer: string };
type RatingBody = { rating: CardRating };

const engineFor = (deps: Pick<IntakeDeps, "engine">): IntakeEngine => deps.engine ?? defaultEngine;

function bodyObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("unprocessable", "body: must be an object");
  }
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) throw new ApiError("unprocessable", `${key}: unknown field`);
  }
  for (const key of keys) {
    if (object[key] === undefined) throw new ApiError("unprocessable", `${key}: is required`);
  }
  return object;
}

function validateWarmupBody(value: unknown): WarmupBody {
  const body = bodyObject(value, ["questionKey", "answer"]);
  if (typeof body.questionKey !== "string" || body.questionKey.trim() === "") {
    throw new ApiError("unprocessable", "questionKey: must be a non-empty string");
  }
  if (typeof body.answer !== "string") throw new ApiError("unprocessable", "answer: must be a string");
  const answer = body.answer.trim();
  if (answer.length < 1 || answer.length > 500) {
    throw new ApiError("unprocessable", "answer: must be between 1 and 500 characters after trimming");
  }
  return { questionKey: body.questionKey, answer };
}

function validateRatingBody(value: unknown): RatingBody {
  const body = bodyObject(value, ["rating"]);
  if (body.rating !== "like" && body.rating !== "maybe" && body.rating !== "no") {
    throw new ApiError("unprocessable", "rating: must be one of like, maybe, no");
  }
  return { rating: body.rating };
}

function validatePractical(value: unknown): IntakePractical {
  const required = ["locations", "remote", "hoursPerWeek", "courseBudget", "education", "languages", "dreamCompanies"];
  const body = bodyObject(value, required);
  if (!Array.isArray(body.languages) || body.languages.length === 0) {
    throw new ApiError("unprocessable", "languages: must have at least 1 item");
  }
  const placeholder = { uri: "urn:stub:occupation:intake-validation", label: "Intake validation", lang: "en" };
  const preferences = validatePreferences({
    targetOccupations: [placeholder],
    locations: body.locations,
    remote: body.remote,
    goal: "learn-fast",
    dreamCompanies: body.dreamCompanies,
    dealBreakers: [],
    languages: body.languages,
    hoursPerWeek: body.hoursPerWeek,
    courseBudget: body.courseBudget,
    education: body.education,
  });
  return {
    locations: preferences.locations,
    remote: preferences.remote,
    hoursPerWeek: preferences.hoursPerWeek,
    courseBudget: preferences.courseBudget,
    education: preferences.education,
    languages: preferences.languages,
    dreamCompanies: preferences.dreamCompanies,
  };
}

function deckFor(deps: IntakeViewDeps, country: string): Deck {
  const normalized = country.toUpperCase();
  try {
    return deps.loadDeck(normalized);
  } catch (error) {
    if (normalized === "CZ") throw error;
    return deps.loadDeck("CZ");
  }
}

function withPreferencePatch(record: SeekerRecord, patch: Partial<CareerPreferences>): SeekerRecord {
  const preferences = { ...record.profile.preferences, ...patch };
  const draft = { ...record.draft, ...patch };
  return isDeepStrictEqual(record.profile.preferences, preferences)
    ? { ...record, draft }
    : { ...record, draft, profile: touch({ ...record.profile, preferences }) };
}

async function ensureState(deps: IntakeDeps, seekerId: string): Promise<{ state: IntakeState; deck: Deck }> {
  const seeker = await loadSeeker(deps, seekerId);
  const stored = await deps.store.getIntake(seekerId);
  if (stored) {
    const state = stored as IntakeState;
    return { state, deck: deckFor(deps, state.deck.country) };
  }
  const country = seeker.profile.preferences.locations[0]?.country ?? "CZ";
  const deck = deckFor(deps, country);
  const state = engineFor(deps).newIntakeState(seekerId, deck);
  await deps.store.putIntake(state);
  return { state, deck };
}

/** Converts private engine state to the exact public Intake response. */
export function publicIntake(deps: IntakeViewDeps, stored: Intake): Intake {
  const state = stored as IntakeState;
  return engineFor(deps).toPublic(state, deckFor(deps, state.deck.country));
}

/** Gets the existing intake or creates it from the seeker's country deck. */
export async function getIntake(deps: IntakeDeps, seekerId: string): Promise<Intake> {
  const { state, deck } = await ensureState(deps, seekerId);
  return engineFor(deps).toPublic(state, deck);
}

/** Maps and records the current warm-up answer, rejecting out-of-order questions. */
export async function answerWarmup(deps: IntakeDeps, seekerId: string, value: unknown): Promise<Intake> {
  const { questionKey, answer } = validateWarmupBody(value);
  const { state, deck } = await ensureState(deps, seekerId);
  if (state.phase !== "warmup" || state.warmup.currentKey !== questionKey) {
    throw new ApiError("conflict", `Warm-up question ${questionKey} is not current`);
  }
  const question = state.warmup.questions.find(({ key }) => key === questionKey);
  if (!question) throw new ApiError("conflict", `Warm-up question ${questionKey} is not current`);

  let mappedTo: string[];
  let reply: string | undefined;
  if (question.options.includes(answer)) {
    mappedTo = [answer];
  } else {
    const result = await (deps.warmupFreeText ?? runWarmupFreeText)(deps, seekerId, question, answer);
    mappedTo = [...new Set(result.mappedTo.filter((option) => question.options.includes(option)))];
    reply = result.reply.trim();
  }

  let next = engineFor(deps).applyWarmup(state, deck, questionKey, mappedTo, answer);
  if (reply !== undefined) {
    next = {
      ...next,
      warmup: {
        ...next.warmup,
        answers: next.warmup.answers.map((item) => item.key === questionKey ? { ...item, reply } : item),
      },
    };
  }
  await deps.store.putIntake(next);

  if (questionKey === "goal") {
    const goal = mappedTo.map((option) => GOAL_BY_OPTION[option]).find((candidate) => candidate !== undefined);
    if (goal) {
      await updateSeeker(deps, seekerId, (record) => {
        const draft = { ...record.draft, goal };
        if (record.profile.preferences.goal === goal) return { ...record, draft };
        const preferences = { ...record.profile.preferences, goal };
        return { ...record, draft, profile: touch({ ...record.profile, preferences }) };
      });
    }
  }
  return engineFor(deps).toPublic(next, deck);
}

/** Rates the current card and advances the intake under the deck stop rule. */
export async function rateCard(deps: IntakeDeps, seekerId: string, cardId: string, value: unknown): Promise<Intake> {
  const { rating } = validateRatingBody(value);
  const { state, deck } = await ensureState(deps, seekerId);
  if (!deck.cards.some((card) => card.cardId === cardId)) throw new ApiError("not_found", `Task card ${cardId} does not exist`);
  if (state.phase !== "cards" || state.cards.current?.cardId !== cardId) {
    throw new ApiError("conflict", `Task card ${cardId} is not current`);
  }
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const updated = await deps.store.updateRecordAndIntake(seekerId, (record, stored) => {
    const current = stored as IntakeState;
    if (current.phase !== "cards" || current.cards.current?.cardId !== cardId) {
      throw new ApiError("conflict", `Task card ${cardId} is not current`);
    }
    const next = engineFor(deps).applyRating(current, deck, cardId, rating, at);
    const targets = next.cards.done && next.practical
      ? next.paths.filter(({ top3 }) => top3).slice(0, 3).map(({ occupation }) => occupation)
      : undefined;
    return {
      record: targets ? withPreferencePatch(record, { targetOccupations: targets }) : record,
      intake: next,
    };
  });
  return engineFor(deps).toPublic(updated.intake as IntakeState, deck);
}

/** Requests four additional cards away from the current top three paths. */
export async function moreCards(deps: IntakeDeps, seekerId: string): Promise<Intake> {
  const { state, deck } = await ensureState(deps, seekerId);
  if (!state.cards.done || state.phase !== "practical" || state.practical !== undefined) {
    throw new ApiError("conflict", "More task cards are not available at this stage");
  }
  const next = engineFor(deps).addMoreCards(state, deck);
  await deps.store.putIntake(next);
  return engineFor(deps).toPublic(next, deck);
}

/** Stores practical constraints and updates profile preferences and target occupations. */
export async function setPractical(deps: IntakeDeps, seekerId: string, value: unknown): Promise<Intake> {
  const practical = validatePractical(value);
  const { state, deck } = await ensureState(deps, seekerId);
  const targets = state.cards.done
    ? state.paths.filter(({ top3 }) => top3).slice(0, 3).map(({ occupation }) => occupation)
    : undefined;
  const next: IntakeState = {
    ...state,
    practical,
    phase: state.phase === "done" ? "done" : state.cards.done ? "chat" : state.phase,
  };

  await updateSeeker(deps, seekerId, (record) => {
    const patch: Partial<CareerPreferences> = {
      locations: practical.locations,
      remote: practical.remote,
      hoursPerWeek: practical.hoursPerWeek,
      courseBudget: practical.courseBudget,
      education: practical.education,
      languages: practical.languages,
      dreamCompanies: practical.dreamCompanies,
      ...(targets ? { targetOccupations: targets } : {}),
    };
    return withPreferencePatch(record, patch);
  });
  await deps.store.putIntake(next);
  return engineFor(deps).toPublic(next, deck);
}

/** Ends the optional post-practical chat. */
export async function skipChat(deps: IntakeDeps, seekerId: string): Promise<Intake> {
  const { state, deck } = await ensureState(deps, seekerId);
  if (state.phase !== "chat") throw new ApiError("conflict", "Intake chat is not current");
  const next: IntakeState = { ...state, phase: "done" };
  await deps.store.putIntake(next);
  return engineFor(deps).toPublic(next, deck);
}

/** Marks an existing chat-phase intake done after the shared interview agent finishes. */
export async function finishChatWhenDone(deps: IntakeDeps, seekerId: string): Promise<void> {
  const stored = await deps.store.getIntake(seekerId);
  if (!stored || stored.phase !== "chat") return;
  await deps.store.putIntake({ ...(stored as IntakeState), phase: "done" });
}
