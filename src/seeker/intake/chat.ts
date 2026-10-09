import type { WarmupQuestion } from "./warmup.ts";
import type { IntakeDeps } from "./service.ts";
import { warmupInterviewTurn } from "../service/interview.ts";

export type WarmupReply = { reply: string; mappedTo: string[] };

/**
 * One interview-agent turn for a free-text warm-up answer (API.md "Guided intake").
 * Replies in 1-2 sentences, records the turn in the interview transcript, adds stated skills and
 * preference updates like a normal interview turn, and returns which of the question's options
 * the answer matches (unknown options dropped).
 */
export async function warmupFreeText(
  deps: IntakeDeps,
  seekerId: string,
  question: WarmupQuestion,
  answer: string,
): Promise<WarmupReply> {
  return warmupInterviewTurn(deps, seekerId, question, answer);
}
