import { ApiError } from "../core/errors.ts";

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  // PDF CVs go to the model as a file part (OpenRouter parses PDFs itself).
  | { role: "user"; content: ({ type: "text"; text: string } | { type: "file"; file: { filename: string; file_data: string } })[] };

export type ChatRequest = { model: string; messages: ChatMessage[]; json?: boolean; temperature?: number };

export interface LlmClient {
  chat(req: ChatRequest): Promise<string>;
}

export const MODELS = {
  interview: process.env.OPENROUTER_MODEL_INTERVIEW ?? "anthropic/claude-sonnet-5.5",
  cv: process.env.OPENROUTER_MODEL_CV ?? "anthropic/claude-sonnet-5.5",
  fast: process.env.OPENROUTER_MODEL_FAST ?? "anthropic/claude-haiku-5.5",
};

// OpenRouter's OpenAI-compatible chat completions endpoint.
export class OpenRouterClient implements LlmClient {
  apiKey: string;
  constructor(apiKey: string | undefined = process.env.OPENROUTER_API_KEY) {
    if (!apiKey) throw new ApiError("internal", "OPENROUTER_API_KEY is not set");
    this.apiKey = apiKey;
  }

  async chat(req: ChatRequest): Promise<string> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new ApiError("upstream_failed", `OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ApiError("upstream_failed", "OpenRouter returned no content");
    return content;
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
