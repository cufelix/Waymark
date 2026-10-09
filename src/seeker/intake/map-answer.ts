import type { LlmClient } from "../llm/llm.ts";
import type { WarmupQuestion } from "./warmup.ts";

/** Maps a free-text warm-up answer to zero or more of that question's option labels. */
export async function mapFreeText(_llm: LlmClient, _question: WarmupQuestion, _answer: string): Promise<string[]> {
  throw new Error("not implemented");
}
