import type { CareerPreferences, Intake, IntakeCurrentCard, TaskCard } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";
import type { Deck } from "./deck.ts";
import { GOAL_BY_OPTION, PRIORS, WARMUP_QUESTIONS } from "./warmup.ts";

export type IntakeState = Omit<Intake, "cards"> & {
  cards: {
    current?: TaskCard;
    rated: Intake["cards"]["rated"];
    done: boolean;
  };
  scores: Record<string, number>;
  shownCounts: Record<string, number>;
  extraUntil: number;
  goal?: CareerPreferences["goal"];
  extraPathKeys?: string[];
};

export type CardRating = "like" | "maybe" | "no";

const RATE: Record<CardRating, number> = { like: 2, maybe: 0.5, no: -1.5 };

function pathOrder(deck: Deck): Map<string, number> {
  return new Map(deck.paths.map((path, index) => [path.key, index]));
}

function rankedPathKeys(state: IntakeState, deck?: Deck): string[] {
  const keys = deck ? deck.paths.map((path) => path.key) : Object.keys(state.scores);
  const order = deck ? pathOrder(deck) : new Map(keys.map((key, index) => [key, index]));
  return keys.sort((a, b) => state.scores[b] - state.scores[a] || (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function publicCard(card: TaskCard): TaskCard {
  return {
    cardId: card.cardId,
    text: card.text,
    occupation: { ...card.occupation },
    related: card.related.map((item) => ({ occupation: { ...item.occupation }, weight: item.weight })),
    source: { ...card.source },
  };
}

function currentCard(card: TaskCard): IntakeCurrentCard {
  return {
    cardId: card.cardId,
    text: card.text,
    source: {
      id: card.source.id,
      fetchedAt: card.source.fetchedAt,
      tool: card.source.tool,
      ...(card.source.quote === undefined ? {} : { quote: card.source.quote }),
      contentHash: card.source.contentHash,
      ...(card.source.snapshotKey === undefined ? {} : { snapshotKey: card.source.snapshotKey }),
    },
  };
}

function finishedPhase(state: IntakeState): Intake["phase"] {
  return state.practical ? "chat" : "practical";
}

/** Creates the private state for a seeker's guided intake. Pure; performs no I/O. */
export function newIntakeState(seekerId: string, deck: Deck): IntakeState {
  const state: IntakeState = {
    seekerId,
    phase: "warmup",
    warmup: {
      questions: WARMUP_QUESTIONS.map((question) => ({
        key: question.key,
        text: question.text,
        options: [...question.options],
      })),
      answers: [],
      currentKey: WARMUP_QUESTIONS[0]?.key,
    },
    cards: { rated: [], done: false },
    paths: [],
    deck: { country: deck.country, version: deck.version },
    scores: Object.fromEntries(deck.paths.map((path) => [path.key, 0])),
    shownCounts: Object.fromEntries(deck.paths.map((path) => [path.key, 0])),
    extraUntil: 0,
  };
  state.paths = orderedPaths(state, deck);
  return state;
}

/** Applies one warm-up answer and its already mapped option labels. Pure; performs no I/O. */
export function applyWarmup(state: IntakeState, deck: Deck, key: string, mappedOptions: string[], answerText: string): IntakeState {
  if (state.phase !== "warmup" || state.warmup.currentKey !== key) {
    throw new ApiError("conflict", `Warm-up question ${key} is not current`);
  }

  const questionIndex = WARMUP_QUESTIONS.findIndex((question) => question.key === key);
  const question = WARMUP_QUESTIONS[questionIndex];
  if (!question) throw new ApiError("conflict", `Warm-up question ${key} is not current`);

  const allowed = new Set(question.options);
  const mappedTo = [...new Set(mappedOptions.filter((option) => allowed.has(option)))];
  const scores = { ...state.scores };
  for (const option of mappedTo) {
    for (const [pathKey, prior] of Object.entries(PRIORS[option] ?? {})) {
      if (pathKey in scores) scores[pathKey] += prior;
    }
  }

  const nextQuestion = WARMUP_QUESTIONS[questionIndex + 1];
  const goal = key === "goal" ? mappedTo.map((option) => GOAL_BY_OPTION[option]).find(Boolean) : undefined;
  const next: IntakeState = {
    ...state,
    scores,
    warmup: {
      questions: state.warmup.questions.map((item) => ({ ...item, options: [...item.options] })),
      answers: [...state.warmup.answers.map((answer) => ({ ...answer, mappedTo: [...answer.mappedTo] })), { key, answer: answerText, mappedTo }],
      ...(nextQuestion ? { currentKey: nextQuestion.key } : {}),
    },
    ...(goal ? { goal } : {}),
  };

  if (!nextQuestion) {
    next.phase = "cards";
    next.cards = { ...next.cards, current: pickNextCard(next, deck) };
    if (!next.cards.current) {
      next.cards.done = true;
      next.phase = finishedPhase(next);
    }
  }
  next.paths = orderedPaths(next, deck);
  return next;
}

/** Applies a rating to the current card at the supplied ISO timestamp. Pure; performs no I/O. */
export function applyRating(state: IntakeState, deck: Deck, cardId: string, rating: CardRating, now: string): IntakeState {
  if (state.phase !== "cards" || state.cards.done || state.cards.current?.cardId !== cardId) {
    throw new ApiError("conflict", `Task card ${cardId} is not current`);
  }

  const card = deck.cards.find((candidate) => candidate.cardId === cardId);
  if (!card) throw new ApiError("conflict", `Task card ${cardId} is not current`);

  const weight = RATE[rating];
  const scores = { ...state.scores, [card.pathKey]: state.scores[card.pathKey] + weight };
  const keyByOccupation = new Map(deck.paths.map((path) => [path.occupation.uri, path.key]));
  for (const related of card.related) {
    const relatedKey = keyByOccupation.get(related.occupation.uri);
    if (relatedKey) scores[relatedKey] += weight * related.weight;
  }

  const shownCounts = {
    ...state.shownCounts,
    [card.pathKey]: (state.shownCounts[card.pathKey] ?? 0) + 1,
  };
  const next: IntakeState = {
    ...state,
    scores,
    shownCounts,
    cards: {
      rated: [
        ...state.cards.rated.map((item) => ({ card: publicCard(item.card), rating: item.rating, at: item.at })),
        { card: publicCard(card), rating, at: now },
      ],
      done: false,
    },
  };
  next.paths = orderedPaths(next, deck);

  if (isConfident(next)) {
    next.cards.done = true;
    next.phase = finishedPhase(next);
    return next;
  }

  const current = pickNextCard(next, deck);
  if (!current) {
    next.cards.done = true;
    next.phase = finishedPhase(next);
  } else {
    next.cards.current = current;
  }
  return next;
}

/** Extends card collection by four cards outside the current top three. Pure; performs no I/O. */
export function addMoreCards(state: IntakeState, deck: Deck): IntakeState {
  const topThree = new Set(rankedPathKeys(state, deck).slice(0, 3));
  const extraPathKeys = deck.paths.map((path) => path.key).filter((key) => !topThree.has(key));
  const seen = new Set(state.cards.rated.map((item) => item.card.cardId));
  const available = deck.cards.filter((card) => !seen.has(card.cardId) && extraPathKeys.includes(card.pathKey)).length;
  const next: IntakeState = {
    ...state,
    phase: "cards",
    cards: {
      rated: state.cards.rated.map((item) => ({ card: publicCard(item.card), rating: item.rating, at: item.at })),
      done: false,
    },
    extraUntil: state.cards.rated.length + Math.min(4, available),
    extraPathKeys,
  };
  const current = available > 0 ? pickNextCard(next, deck) : undefined;
  if (current) next.cards.current = current;
  else {
    next.cards.done = true;
    next.phase = finishedPhase(next);
  }
  next.paths = orderedPaths(next, deck);
  return next;
}

/** Selects the next unseen card that best separates the remaining paths. Pure; performs no I/O. */
export function pickNextCard(state: IntakeState, deck: Deck): TaskCard | undefined {
  const seen = new Set(state.cards.rated.map((item) => item.card.cardId));
  const unseen = deck.cards.filter((card) => !seen.has(card.cardId));
  if (unseen.length === 0) return undefined;

  const ranked = rankedPathKeys(state, deck);
  const isExtraRound = state.extraUntil > state.cards.rated.length && state.extraPathKeys !== undefined;
  const preferred = isExtraRound
    ? ranked.filter((key) => state.extraPathKeys?.includes(key))
    : ranked.slice(0, state.cards.rated.length < 3 ? 6 : 4);
  const candidates = isExtraRound ? unseen.filter((card) => preferred.includes(card.pathKey)) : unseen;
  if (candidates.length === 0) return undefined;
  const order = pathOrder(deck);
  const target = [...preferred].sort((a, b) =>
    (state.shownCounts[a] ?? 0) - (state.shownCounts[b] ?? 0) ||
    state.scores[b] - state.scores[a] ||
    (order.get(a) ?? 0) - (order.get(b) ?? 0)
  )[0];

  const selected = candidates.find((card) => card.pathKey === target) ??
    candidates.find((card) => preferred.includes(card.pathKey)) ??
    candidates[0];
  return selected ? publicCard(selected) : undefined;
}

/** Reports whether the top three are clear under the prototype's 8-to-12-card stop rule. */
export function isConfident(state: IntakeState): boolean {
  const rated = state.cards.rated.length;
  if (state.extraUntil > 0) return rated >= state.extraUntil;
  if (rated >= 12) return true;
  if (rated < 8) return false;
  const ranked = rankedPathKeys(state);
  return ranked.length >= 4 && state.scores[ranked[2]] - state.scores[ranked[3]] >= 2;
}

/** Returns paths in seeker-interest order with only the seeker's rating counts. */
export function orderedPaths(state: IntakeState, deck: Deck): Intake["paths"] {
  const ranked = rankedPathKeys(state, deck);
  return ranked.map((key, index) => {
    const path = deck.paths.find((candidate) => candidate.key === key)!;
    const ratings = state.cards.rated.filter((item) => deck.cards.find((card) => card.cardId === item.card.cardId)?.pathKey === key);
    return {
      occupation: { ...path.occupation },
      liked: ratings.filter((item) => item.rating === "like").length,
      maybe: ratings.filter((item) => item.rating === "maybe").length,
      notForMe: ratings.filter((item) => item.rating === "no").length,
      top3: index < 3,
    };
  });
}

/** Removes all private engine fields and returns the API contract view. */
export function toPublic(state: IntakeState, deck: Deck): Intake {
  return {
    seekerId: state.seekerId,
    phase: state.phase,
    warmup: {
      questions: state.warmup.questions.map((question) => ({ ...question, options: [...question.options] })),
      answers: state.warmup.answers.map((answer) => ({ ...answer, mappedTo: [...answer.mappedTo] })),
      ...(state.warmup.currentKey ? { currentKey: state.warmup.currentKey } : {}),
    },
    cards: {
      ...(state.cards.current ? { current: currentCard(state.cards.current) } : {}),
      rated: state.cards.rated.map((item) => ({ card: publicCard(item.card), rating: item.rating, at: item.at })),
      done: state.cards.done,
    },
    paths: orderedPaths(state, deck),
    ...(state.practical
      ? {
          practical: {
            locations: state.practical.locations.map((location) => ({ ...location })),
            remote: state.practical.remote,
            hoursPerWeek: state.practical.hoursPerWeek,
            courseBudget: state.practical.courseBudget,
            education: state.practical.education,
            languages: state.practical.languages.map((language) => ({ ...language })),
            dreamCompanies: state.practical.dreamCompanies.map((company) => ({ ...company })),
          },
        }
      : {}),
    deck: { ...state.deck },
  };
}
