import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../core/errors.ts";
import type { Deck } from "./deck.ts";
import {
  addMoreCards,
  applyRating,
  applyWarmup,
  isConfident,
  newIntakeState,
  pickNextCard,
  toPublic,
  type CardRating,
  type IntakeState,
} from "./engine.ts";
import { FAKE_DECK } from "./testdata/deck.ts";
import { WARMUP_QUESTIONS } from "./warmup.ts";

function finishWarmup(): IntakeState {
  let state = newIntakeState("skr_test", FAKE_DECK);
  state = applyWarmup(state, FAKE_DECK, "drawn", ["Figuring out why something broke"], "I debug things");
  state = applyWarmup(state, FAKE_DECK, "with", ["Building things"], "Building things");
  return applyWarmup(state, FAKE_DECK, "goal", ["A stable job and salary"], "Stability");
}

function rateCurrent(state: IntakeState, rating: CardRating = "maybe"): IntakeState {
  assert.ok(state.cards.current);
  return applyRating(state, FAKE_DECK, state.cards.current.cardId, rating, "2026-10-09T12:00:00Z");
}

test("full warm-up stores answers and priors, then selects the first task card", () => {
  const initial = newIntakeState("skr_test", FAKE_DECK);
  assert.equal(initial.phase, "warmup");
  assert.equal(initial.warmup.currentKey, WARMUP_QUESTIONS[0].key);

  const state = finishWarmup();
  assert.equal(state.phase, "cards");
  assert.equal(state.warmup.currentKey, undefined);
  assert.deepEqual(state.warmup.answers.map((answer) => answer.mappedTo), [
    ["Figuring out why something broke"],
    ["Building things"],
    ["A stable job and salary"],
  ]);
  assert.equal(state.goal, "stability");
  assert.equal(state.scores.backend, 3);
  assert.equal(state.scores.qa, 2.5);
  assert.equal(state.cards.current?.cardId, FAKE_DECK.cards[0].cardId);
});

test("card picking is deterministic and balances shown paths with score tie-breaks", () => {
  let state = finishWarmup();
  assert.equal(pickNextCard(state, FAKE_DECK)?.cardId, FAKE_DECK.cards[0].cardId);
  state = rateCurrent(state, "maybe");
  assert.equal(state.cards.current?.occupation.uri, FAKE_DECK.paths[3].occupation.uri);
  state = rateCurrent(state, "maybe");
  assert.equal(state.cards.current?.occupation.uri, FAKE_DECK.paths[1].occupation.uri);
});

test("confidence never stops before 8 cards, stops on a clear middle gap, and always stops at 12", () => {
  const base = newIntakeState("skr_test", FAKE_DECK);
  const ratedCard = FAKE_DECK.cards[0];
  const rated = Array.from({ length: 7 }, (_, index) => ({ card: ratedCard, rating: "like" as const, at: `2026-10-09T00:00:0${index}Z` }));
  const scores = { ...base.scores, backend: 8, frontend: 7, data: 6, qa: 0 };
  assert.equal(isConfident({ ...base, scores, cards: { rated, done: false } }), false);
  assert.equal(isConfident({ ...base, scores, cards: { rated: [...rated, rated[0]], done: false } }), true);

  const closeScores = { ...base.scores, backend: 4, frontend: 3, data: 2, qa: 1.5 };
  assert.equal(isConfident({ ...base, scores: closeScores, cards: { rated: Array(11).fill(rated[0]), done: false } }), false);
  assert.equal(isConfident({ ...base, scores: closeScores, cards: { rated: Array(12).fill(rated[0]), done: false } }), true);
});

test("ratings update primary and related paths, then move to practical when confident", () => {
  let state = finishWarmup();
  state = rateCurrent(state, "like");
  assert.equal(state.scores.backend, 5);

  while (!state.cards.done) state = rateCurrent(state, "like");
  assert.ok(state.cards.rated.length >= 8 && state.cards.rated.length <= 12);
  assert.equal(state.cards.done, true);
  assert.equal(state.phase, "practical");
  assert.equal(state.cards.current, undefined);
  assert.ok(state.paths.some((path) => path.liked > 0));
});

test("a rating applies the card's weight to primary and related paths", () => {
  const base = newIntakeState("skr_test", FAKE_DECK);
  const relatedCard = FAKE_DECK.cards[1];
  const state = {
    ...base,
    phase: "cards" as const,
    cards: { current: relatedCard, rated: [], done: false },
  };
  const next = applyRating(state, FAKE_DECK, relatedCard.cardId, "like", "2026-10-09T12:00:00Z");
  assert.equal(next.scores.backend, 2);
  assert.equal(next.scores.qa, 1);
  assert.equal(next.shownCounts.backend, 1);
  assert.equal(next.cards.rated[0].at, "2026-10-09T12:00:00Z");
  assert.equal(next.paths.find((path) => path.occupation.uri === relatedCard.occupation.uri)?.liked, 1);
  assert.ok("occupation" in toPublic(next, FAKE_DECK).cards.rated[0].card);
});

test("finishing cards enters chat when practical details already exist", () => {
  let state = finishWarmup();
  let beforeDone = state;
  while (!state.cards.done) {
    beforeDone = state;
    state = rateCurrent(state, "like");
  }
  const practical = {
    locations: [{ country: "CZ", city: "Prague" }],
    remote: "ok" as const,
    hoursPerWeek: "10-20" as const,
    courseBudget: "some" as const,
    education: "bachelor" as const,
    languages: [{ lang: "cs", level: "native" as const }],
    dreamCompanies: [],
  };
  const final = rateCurrent({ ...beforeDone, practical }, "like");
  assert.equal(final.cards.done, true);
  assert.equal(final.phase, "chat");
});

test("more cards rates exactly four cards from outside the prior top three", () => {
  let state = finishWarmup();
  while (!state.cards.done) state = rateCurrent(state, "like");
  const topUris = new Set(state.paths.filter((path) => path.top3).map((path) => path.occupation.uri));
  const before = state.cards.rated.length;

  state = addMoreCards(state, FAKE_DECK);
  assert.equal(state.phase, "cards");
  while (!state.cards.done) state = rateCurrent(state, "maybe");

  const extra = state.cards.rated.slice(before);
  assert.equal(extra.length, 4);
  assert.ok(extra.every((item) => !topUris.has(item.card.occupation.uri)));
});

test("more cards returns to chat or done without asking for practical details again", () => {
  const practical = {
    locations: [{ country: "CZ", city: "Example City" }],
    remote: "ok" as const,
    hoursPerWeek: "5-10" as const,
    courseBudget: "some" as const,
    education: "bachelor" as const,
    languages: [{ lang: "en", level: "working" as const }],
    dreamCompanies: [{ name: "Example Company" }],
  };

  for (const returnPhase of ["chat", "done"] as const) {
    let state = finishWarmup();
    while (!state.cards.done) state = rateCurrent(state, "like");
    state = addMoreCards({ ...state, phase: returnPhase, practical }, FAKE_DECK);
    assert.equal(state.phase, "cards");
    while (!state.cards.done) state = rateCurrent(state, "maybe");
    assert.equal(state.phase, returnPhase);
    assert.deepEqual(state.practical, practical);
    assert.equal(state.resumeAfterCards, undefined);
  }
});

test("more cards rejects decks with fewer than four unseen cards outside the prior top three", () => {
  let state = finishWarmup();
  while (!state.cards.done) state = rateCurrent(state, "like");
  const topUris = new Set(state.paths.filter((path) => path.top3).map((path) => path.occupation.uri));
  const seenIds = new Set(state.cards.rated.map((item) => item.card.cardId));
  const ratedCards = state.cards.rated.map((item) => FAKE_DECK.cards.find((card) => card.cardId === item.card.cardId)!);
  const eligible = FAKE_DECK.cards.filter((card) => !seenIds.has(card.cardId) && !topUris.has(card.occupation.uri)).slice(0, 2);
  assert.equal(eligible.length, 2);
  const shortDeck: Deck = { ...FAKE_DECK, cards: [...ratedCards, ...eligible] };
  assert.throws(
    () => addMoreCards(state, shortDeck),
    (error) => error instanceof ApiError && error.code === "conflict",
  );

  const noExtraDeck: Deck = { ...FAKE_DECK, cards: ratedCards };
  assert.throws(
    () => addMoreCards(state, noExtraDeck),
    (error) => error instanceof ApiError && error.code === "conflict",
  );
});

test("public intake hides the current occupation and every private or assessment-like field", () => {
  const state = finishWarmup();
  const intake = toPublic(state, FAKE_DECK);
  assert.ok(intake.cards.current);
  assert.equal("occupation" in intake.cards.current, false);
  assert.equal("related" in intake.cards.current, false);
  assert.equal("title" in intake.cards.current.source, false);
  assert.equal("url" in intake.cards.current.source, false);
  assert.equal(intake.cards.current.source.quote, intake.cards.current.text);
  const rated = applyRating(state, FAKE_DECK, state.cards.current.cardId, "like", "2026-10-09T12:00:00Z");
  assert.equal(rated.cards.rated[0].card.source.title, FAKE_DECK.cards[0].source.title);
  assert.equal(rated.cards.rated[0].card.source.url, FAKE_DECK.cards[0].source.url);

  const forbidden = /score|fit|match|percent|probability/i;
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(scan);
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, forbidden);
      scan(child);
    }
  };
  scan(intake);
  assert.equal("shownCounts" in intake, false);
  assert.equal("extraUntil" in intake, false);
  assert.equal("goal" in intake, false);
});

test("only the current card can be rated", () => {
  const state = finishWarmup();
  const other = FAKE_DECK.cards.find((card) => card.cardId !== state.cards.current?.cardId)!;
  assert.throws(
    () => applyRating(state, FAKE_DECK, other.cardId, "like", "2026-10-09T12:00:00Z"),
    (error) => error instanceof ApiError && error.code === "conflict",
  );
});
