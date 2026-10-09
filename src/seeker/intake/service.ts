import type { Intake, IntakePractical } from "../contracts.ts";
import type { LlmClient } from "../llm/llm.ts";
import type { SeekerStore } from "../store/store.ts";
import type { Deck } from "./deck.ts";
import type { CardRating } from "./engine.ts";

export type IntakeDeps = {
  store: SeekerStore;
  llm: LlmClient;
  loadDeck: (country: string) => Deck;
};

/** Gets the existing intake or creates it from the seeker's country deck. */
export async function getIntake(_deps: IntakeDeps, _seekerId: string): Promise<Intake> {
  throw new Error("not implemented");
}

/** Maps and records the current warm-up answer, rejecting out-of-order questions. */
export async function answerWarmup(_deps: IntakeDeps, _seekerId: string, _questionKey: string, _answer: string): Promise<Intake> {
  throw new Error("not implemented");
}

/** Rates the current card and advances the intake under the deck stop rule. */
export async function rateCard(_deps: IntakeDeps, _seekerId: string, _cardId: string, _rating: CardRating): Promise<Intake> {
  throw new Error("not implemented");
}

/** Requests four additional cards away from the current top three paths. */
export async function moreCards(_deps: IntakeDeps, _seekerId: string): Promise<Intake> {
  throw new Error("not implemented");
}

/** Stores practical constraints and updates profile preferences and target occupations. */
export async function setPractical(_deps: IntakeDeps, _seekerId: string, _practical: IntakePractical): Promise<Intake> {
  throw new Error("not implemented");
}
