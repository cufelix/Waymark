import { MODELS, type LlmClient } from "../llm/llm.ts";
import type { WarmupQuestion } from "./warmup.ts";

/** Maps a free-text warm-up answer to zero or more of that question's option labels. */
export async function mapFreeText(llm: LlmClient, question: WarmupQuestion, answer: string): Promise<string[]> {
  try {
    const raw = await llm.chat({
      model: MODELS.fast,
      json: true,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Map the answer to zero or more supplied option labels. Return only strict JSON as {\"mappedTo\":[\"exact option label\"]}. " +
            "Use only labels from the supplied options, include each at most once, and return an empty array when none fits.",
        },
        {
          role: "user",
          content: JSON.stringify({ question: question.text, options: question.options, answer }),
        },
      ],
    });
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as Record<string, unknown>).mappedTo)
      ? (parsed as Record<string, unknown>).mappedTo
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as Record<string, unknown>).options)
      ? (parsed as Record<string, unknown>).options
      : [];
    const allowed = new Set(question.options);
    return [...new Set(values.filter((value): value is string => typeof value === "string" && allowed.has(value)))];
  } catch {
    return [];
  }
}
