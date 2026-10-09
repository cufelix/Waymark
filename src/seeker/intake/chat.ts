import type { WarmupQuestion } from "./warmup.ts";
import type { IntakeDeps } from "./service.ts";

export type WarmupReply = { reply: string; mappedTo: string[] };

/**
 * One interview-agent turn for a free-text warm-up answer (API.md "Guided intake").
 * Replies in 1-2 sentences, records the turn in the interview transcript, adds stated skills and
 * preference updates like a normal interview turn, and returns which of the question's options
 * the answer matches (unknown options dropped).
 */
export async function warmupFreeText(
  _deps: IntakeDeps,
  _seekerId: string,
  _question: WarmupQuestion,
  _answer: string,
): Promise<WarmupReply> {
  throw new Error("not implemented");
}
