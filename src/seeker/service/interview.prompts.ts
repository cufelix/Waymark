import type { CareerPreferencesDraft, InterviewTurn } from "../contracts.ts";
import type { ChatMessage } from "../llm/llm.ts";

export const FIRST_INTERVIEW_QUESTION = "What kind of role or occupation are you looking for next?";

export const INTERVIEW_SYSTEM_PROMPT = `You conduct a short career-preferences intake interview.

Return only strict JSON with exactly this shape:
{"reply":"string","done":false,"draftPatch":{},"statedSkills":[{"label":"string","quote":"exact excerpt from the latest seeker message"}]}

Rules:
- Reply in the language used by the seeker.
- Ask one short question about one topic at a time. Finish within eight agent questions.
- Collect targetOccupations, locations, remote, goal, dreamCompanies, dealBreakers, languages, and optional salaryExpectation. Also ask about relevant skills and experience.
- targetOccupations must be free-text strings; the application maps them to taxonomy entries.
- locations use ISO 3166-1 alpha-2 country codes. languages use BCP 47 tags. Currency uses ISO 4217.
- remote is only, ok, or no.
- goal is learn-fast, stability, or mission. When asking about it, explain plainly: learn-fast means rapid learning and growth; stability means predictability and security; mission means meaningful work for a cause.
- draftPatch contains only facts explicitly stated by the seeker. Preserve ambiguity by asking a follow-up instead of guessing.
- statedSkills contains only skills explicitly mentioned in the latest seeker message. quote must be a verbatim substring of that message.
- Only record what the seeker says. Never invent, infer, score, judge, rank, assess fit, or estimate the person's chances.
- Set done to true when the required preferences are collected, or when the eighth agent question is reached.`;

export function interviewMessages(
  transcript: InterviewTurn[],
  draft: CareerPreferencesDraft,
  latestText: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: INTERVIEW_SYSTEM_PROMPT },
    {
      role: "system",
      content: `Current validated draft (JSON; it may be incomplete): ${JSON.stringify(draft)}`,
    },
  ];

  for (const turn of transcript) {
    messages.push({ role: turn.role === "agent" ? "assistant" : "user", content: turn.text });
  }
  messages.push({ role: "user", content: latestText });
  return messages;
}
