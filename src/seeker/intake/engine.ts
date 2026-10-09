import type { Intake, TaskCard } from "../contracts.ts";
import type { Deck } from "./deck.ts";

export type IntakeState = Intake & {
  scores: Record<string, number>;
  shownCounts: Record<string, number>;
  extraUntil: number;
};

export type CardRating = "like" | "maybe" | "no";

/** Creates the private state for a seeker's guided intake. Pure; performs no I/O. */
export function newIntakeState(_seekerId: string, _deck: Deck): IntakeState {
  throw new Error("not implemented");
}

/** Applies one warm-up answer and its already mapped option labels. Pure; performs no I/O. */
export function applyWarmup(_state: IntakeState, _deck: Deck, _key: string, _mappedOptions: string[], _answerText: string): IntakeState {
  throw new Error("not implemented");
}

/** Applies a rating to the current card at the supplied ISO timestamp. Pure; performs no I/O. */
export function applyRating(_state: IntakeState, _deck: Deck, _cardId: string, _rating: CardRating, _now: string): IntakeState {
  throw new Error("not implemented");
}

/** Extends card collection by four cards outside the current top three. Pure; performs no I/O. */
export function addMoreCards(_state: IntakeState, _deck: Deck): IntakeState {
  throw new Error("not implemented");
}

/** Selects the next unseen card that best separates the remaining paths. Pure; performs no I/O. */
export function pickNextCard(_state: IntakeState, _deck: Deck): TaskCard | undefined {
  throw new Error("not implemented");
}

/** Reports whether the top three are clear under the prototype's 8-to-12-card stop rule. */
export function isConfident(_state: IntakeState): boolean {
  throw new Error("not implemented");
}

/** Returns paths in seeker-interest order with only the seeker's rating counts. */
export function orderedPaths(_state: IntakeState, _deck: Deck): Intake["paths"] {
  throw new Error("not implemented");
}

/** Removes all private engine fields and returns the API contract view. */
export function toPublic(_state: IntakeState, _deck: Deck): Intake {
  throw new Error("not implemented");
}
