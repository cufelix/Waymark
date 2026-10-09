import assert from "node:assert/strict";
import { test } from "node:test";
import type { Consent, Intake } from "../contracts.ts";
import { ApiError } from "../core/errors.ts";
import { FakeLlm } from "../llm/llm.ts";
import { createSeeker } from "../service/seekers.ts";
import { MemoryStore } from "../store/memory.ts";
import type { Deck } from "./deck.ts";
import type { IntakeState } from "./engine.ts";
import {
  answerWarmup,
  getIntake,
  moreCards,
  rateCard,
  setPractical,
  skipChat,
  type IntakeDeps,
  type IntakeEngine,
} from "./service.ts";
import { FAKE_DECK } from "./testdata/deck.ts";
import { WARMUP_QUESTIONS } from "./warmup.ts";

const consent: Consent = {
  dataProcessing: true,
  nameSearch: false,
  givenAt: "2026-10-08T21:00:00Z",
  policyVersion: "2026-10-01",
};

const practical = {
  locations: [{ country: "CZ", city: "Prague" }],
  remote: "ok",
  hoursPerWeek: "5-10",
  courseBudget: "some",
  education: "bachelor",
  languages: [{ lang: "cs", level: "native" }],
  dreamCompanies: [{ name: "Example Labs", url: "https://example.com" }],
} as const;

function publicView(state: IntakeState): Intake {
  return {
    seekerId: state.seekerId,
    phase: state.phase,
    warmup: structuredClone(state.warmup),
    cards: structuredClone(state.cards),
    paths: structuredClone(state.paths),
    ...(state.practical ? { practical: structuredClone(state.practical) } : {}),
    deck: structuredClone(state.deck),
  };
}

function fakeEngine(): IntakeEngine {
  return {
    newIntakeState(seekerId: string, deck: Deck): IntakeState {
      return {
        seekerId,
        phase: "warmup",
        warmup: { questions: structuredClone(WARMUP_QUESTIONS), answers: [], currentKey: WARMUP_QUESTIONS[0].key },
        cards: { done: false, rated: [] },
        paths: deck.paths.map(({ occupation }, index) => ({ occupation, liked: 0, maybe: 0, notForMe: 0, top3: index < 3 })),
        deck: { country: deck.country, version: deck.version },
        scores: Object.fromEntries(deck.paths.map(({ key }) => [key, 0])),
        shownCounts: Object.fromEntries(deck.paths.map(({ key }) => [key, 0])),
        extraUntil: 0,
      };
    },
    applyWarmup(state, deck, key, mappedTo, answerText): IntakeState {
      const index = state.warmup.questions.findIndex((question) => question.key === key);
      const nextQuestion = state.warmup.questions[index + 1];
      return {
        ...state,
        phase: nextQuestion ? "warmup" : "cards",
        warmup: {
          ...state.warmup,
          answers: [...state.warmup.answers, { key, answer: answerText, mappedTo }],
          ...(nextQuestion ? { currentKey: nextQuestion.key } : { currentKey: undefined }),
        },
        cards: nextQuestion ? state.cards : { ...state.cards, current: deck.cards[0] },
      };
    },
    applyRating(state, deck, cardId, rating, at): IntakeState {
      const card = deck.cards.find((candidate) => candidate.cardId === cardId)!;
      const paths = state.paths.map((path, index) => index === 0
        ? {
            ...path,
            liked: path.liked + (rating === "like" ? 1 : 0),
            maybe: path.maybe + (rating === "maybe" ? 1 : 0),
            notForMe: path.notForMe + (rating === "no" ? 1 : 0),
          }
        : path);
      return {
        ...state,
        phase: "practical",
        cards: { rated: [...state.cards.rated, { card, rating, at }], done: true },
        paths,
      };
    },
    addMoreCards(state, deck): IntakeState {
      return { ...state, phase: "cards", cards: { ...state.cards, done: false, current: deck.cards[1] }, extraUntil: state.cards.rated.length + 4 };
    },
    toPublic: (state) => publicView(state),
  };
}

async function setup(load: (country: string) => Deck = () => FAKE_DECK) {
  const store = new MemoryStore();
  const seekerId = (await createSeeker({ store }, consent)).seekerId;
  const deps: IntakeDeps = { store, llm: new FakeLlm([]), loadDeck: load, engine: fakeEngine() };
  return { deps, store, seekerId };
}

const rejectsCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

test("getIntake creates once, uses the profile country, and falls back to CZ", async () => {
  const countries: string[] = [];
  const { deps, store, seekerId } = await setup((country) => {
    countries.push(country);
    if (country !== "CZ") throw new ApiError("internal", "missing deck");
    return FAKE_DECK;
  });
  await store.update(seekerId, (record) => ({
    ...record,
    profile: { ...record.profile, preferences: { ...record.profile.preferences, locations: [{ country: "DE" }] } },
  }));

  const first = await getIntake(deps, seekerId);
  const second = await getIntake(deps, seekerId);
  assert.equal(first.warmup.currentKey, "drawn");
  assert.deepEqual(second, first);
  assert.deepEqual(countries, ["DE", "CZ", "CZ"]);
  await assert.rejects(getIntake(deps, "skr_01M4EPBGAC0000000000000000"), rejectsCode("not_found"));
});

test("warm-up validates order, trims answers, stores free-text replies, and updates the goal draft/profile", async () => {
  const { deps, store, seekerId } = await setup();
  deps.warmupFreeText = async () => ({ reply: " That sounds like investigative work. ", mappedTo: ["Figuring out why something broke", "invented"] });

  await assert.rejects(answerWarmup(deps, seekerId, { questionKey: "with", answer: "Building things" }), rejectsCode("conflict"));
  await assert.rejects(answerWarmup(deps, seekerId, { questionKey: "drawn", answer: "x", extra: true }), rejectsCode("unprocessable"));
  const free = await answerWarmup(deps, seekerId, { questionKey: "drawn", answer: "  Debugging strange failures  " });
  assert.deepEqual(free.warmup.answers[0], {
    key: "drawn",
    answer: "Debugging strange failures",
    mappedTo: ["Figuring out why something broke"],
    reply: "That sounds like investigative work.",
  });
  await answerWarmup(deps, seekerId, { questionKey: "with", answer: "Building things" });
  const beforeGoal = (await store.get(seekerId))!.profile.profileVersion;
  const final = await answerWarmup(deps, seekerId, { questionKey: "goal", answer: "A stable job and salary" });
  const record = (await store.get(seekerId))!;
  assert.equal(final.phase, "cards");
  assert.equal(record.draft.goal, "stability");
  assert.equal(record.profile.preferences.goal, "stability");
  assert.equal(record.profile.profileVersion, beforeGoal + 1);
});

test("ratings enforce exact bodies and current/known cards; more cards requires a finished round", async () => {
  const { deps, seekerId } = await setup();
  await getIntake(deps, seekerId);
  await answerWarmup(deps, seekerId, { questionKey: "drawn", answer: "Organising chaos" });
  await answerWarmup(deps, seekerId, { questionKey: "with", answer: "Working with people" });
  const cards = await answerWarmup(deps, seekerId, { questionKey: "goal", answer: "Learn fast and grow" });
  const current = cards.cards.current!;

  await assert.rejects(moreCards(deps, seekerId), rejectsCode("conflict"));
  await assert.rejects(rateCard(deps, seekerId, current.cardId, { rating: "love" }), rejectsCode("unprocessable"));
  await assert.rejects(rateCard(deps, seekerId, FAKE_DECK.cards[1].cardId, { rating: "like" }), rejectsCode("conflict"));
  await assert.rejects(rateCard(deps, seekerId, "crd_00000000000000000000000099", { rating: "like" }), rejectsCode("not_found"));
  const rated = await rateCard(deps, seekerId, current.cardId, { rating: "like" });
  assert.equal(rated.cards.done, true);
  assert.equal(rated.cards.rated[0].rating, "like");
  const extra = await moreCards(deps, seekerId);
  assert.equal(extra.phase, "cards");
  assert.equal(extra.cards.done, false);
});

test("practical validation is strict and targets only appear after cards finish; chat can be skipped", async () => {
  const early = await setup();
  await getIntake(early.deps, early.seekerId);
  await assert.rejects(setPractical(early.deps, early.seekerId, { ...practical, languages: [] }), rejectsCode("unprocessable"));
  await assert.rejects(setPractical(early.deps, early.seekerId, { ...practical, surprise: true }), rejectsCode("unprocessable"));
  const beforeCards = await setPractical(early.deps, early.seekerId, practical);
  assert.equal(beforeCards.phase, "warmup");
  assert.deepEqual((await early.store.get(early.seekerId))!.profile.preferences.targetOccupations, []);

  const done = await setup();
  await getIntake(done.deps, done.seekerId);
  await done.store.putIntake({
    ...((await done.store.getIntake(done.seekerId)) as IntakeState),
    phase: "practical",
    cards: { rated: [], done: true },
  });
  const afterCards = await setPractical(done.deps, done.seekerId, practical);
  const record = (await done.store.get(done.seekerId))!;
  assert.equal(afterCards.phase, "chat");
  assert.equal(record.profile.status, "complete");
  assert.deepEqual(record.profile.preferences.targetOccupations, afterCards.paths.slice(0, 3).map(({ occupation }) => occupation));
  assert.deepEqual(record.profile.preferences.languages, practical.languages);
  assert.deepEqual(record.profile.preferences.dreamCompanies, practical.dreamCompanies);
  assert.equal((await skipChat(done.deps, done.seekerId)).phase, "done");
  await assert.rejects(skipChat(done.deps, done.seekerId), rejectsCode("conflict"));
});
