import { ApiError } from "../core/errors.ts";
import { openRouterProviderPolicy } from "../../openrouter-privacy.ts";

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  // PDF CVs go to the model as a file part (OpenRouter parses PDFs itself); photos of a CV as an image part.
  | { role: "user"; content: ContentPart[] };

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } } // data:application/pdf;base64,…
  | { type: "image_url"; image_url: { url: string } }; // data:image/png;base64,…

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  json?: boolean;
  temperature?: number;
  maxCompletionTokens?: number;
};

export interface LlmClient {
  chat(req: ChatRequest): Promise<string>;
}

export const MODELS = {
  interview: process.env.OPENROUTER_MODEL_INTERVIEW ?? "anthropic/claude-sonnet-5.5",
  cv: process.env.OPENROUTER_MODEL_CV ?? "anthropic/claude-sonnet-5.5",
  fast: process.env.OPENROUTER_MODEL_FAST ?? "anthropic/claude-haiku-5.5",
};

// OpenRouter's OpenAI-compatible chat completions endpoint.
/** Strips a ```json fence or text around a single JSON object; returns the input unchanged when there is none. */
export function unfence(raw: string): string {
  const inner = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1] ?? raw;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  return start >= 0 && end > start ? inner.slice(start, end + 1) : raw;
}

export class OpenRouterClient implements LlmClient {
  apiKey: string;
  timeoutMs: number;
  constructor(apiKey: string | undefined = process.env.OPENROUTER_API_KEY, timeoutMs = 120_000) {
    if (!apiKey) throw new ApiError("internal", "OPENROUTER_API_KEY is not set");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async chat(req: ChatRequest): Promise<string> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        ...(req.maxCompletionTokens === undefined ? {} : { max_completion_tokens: req.maxCompletionTokens }),
        provider: openRouterProviderPolicy(),
        // JSON mode through OpenRouter cuts Claude's longer replies off mid-object; unfence() parses plain replies instead.
        ...(req.json && !req.model.startsWith("anthropic/") ? { response_format: { type: "json_object" } } : {}),
        // Reasoning (on by default) spends the token budget before the answer; structured replies don't need it.
        ...(req.json ? { reasoning: { effort: "minimal" } } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    // The upstream body can echo prompts or account details, so clients only get the status.
    if (!res.ok) throw new ApiError("upstream_failed", `LLM provider returned ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ApiError("upstream_failed", "OpenRouter returned no content");
    // Claude via OpenRouter often wraps JSON-mode replies in a ```json fence; hand callers the bare object.
    return req.json ? unfence(content) : content;
  }
}

// Tests use this: returns queued answers in order, records what it was asked.
export class FakeLlm implements LlmClient {
  answers: string[];
  calls: ChatRequest[] = [];
  constructor(answers: string[]) {
    this.answers = [...answers];
  }
  async chat(req: ChatRequest): Promise<string> {
    this.calls.push(req);
    const next = this.answers.shift();
    if (next === undefined) throw new Error("FakeLlm: no answers left");
    return next;
  }
}
