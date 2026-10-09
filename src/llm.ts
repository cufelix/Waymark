// OpenRouter chat client (OpenAI-compatible API). One key covers Claude and other models.
import { z } from "zod";
import { config } from "./config";
import { log } from "./log";
import { releaseCost, reserveCost, settleCost } from "./ledger";
import { openRouterProviderPolicy } from "./openrouter-privacy";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatResult = { message: Extract<ChatMessage, { role: "assistant" }>; usd: number; tokens: number };

export class LlmUnavailableError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not set");
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(
  messages: ChatMessage[],
  opts: { model?: string; tools?: ToolSpec[]; json?: boolean; runId?: string; maxTokens?: number; reasoning?: boolean } = {},
): Promise<ChatResult> {
  if (!config.OPENROUTER_API_KEY) throw new LlmUnavailableError();
  const model = opts.model ?? config.LLM_AGENT_MODEL;
  const body = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 4000,
    usage: { include: true },
    provider: openRouterProviderPolicy(),
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    // Reasoning is on by default on OpenRouter and spends the token budget before the answer; extraction doesn't need it.
    // (Sonnet 5.5 refuses "enabled: false", so ask for minimal effort, which every model accepts.)
    ...(opts.reasoning === false ? { reasoning: { effort: "minimal" } } : {}),
  };

  const reservation = await reserveCost("llm", { runId: opts.runId, detail: model });
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      await releaseCost(reservation);
      throw err;
    }
    if (RETRYABLE.has(res.status) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      await releaseCost(reservation);
      throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
      usage?: { total_tokens?: number; cost?: number };
      error?: { message: string };
    };
    const choice = data.choices?.[0];
    const tokens = data.usage?.total_tokens ?? 0;
    // Cost missing from the response: keep the reserved estimate rather than recording $0.
    const usd = data.usage?.cost ?? null;
    try {
      await settleCost(reservation, { usd, units: tokens, detail: model });
    } catch (err) {
      log.error("cost settle failed", { model, error: String(err) });
    }
    if (!choice) throw new Error(`OpenRouter returned no choice: ${data.error?.message ?? "unknown"}`);
    return { message: { role: "assistant", content: choice.message.content, tool_calls: choice.message.tool_calls }, usd: usd ?? 0, tokens };
  }
}

/** Asks for JSON, validates it with the schema, and retries once with the validation error. */
export async function chatJson<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
  opts: { model?: string; runId?: string; maxTokens?: number } = {},
): Promise<{ value: T; usd: number }> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${system}\nReply with one JSON object only.` },
    { role: "user", content: user },
  ];
  let usd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    // No JSON mode: through OpenRouter it cuts Claude's longer replies off mid-object. The prompt asks for JSON
    // and parseJsonLoose takes the object out of any fence or surrounding text.
    const res = await chat(messages, { ...opts, model: opts.model ?? config.LLM_FAST_MODEL, reasoning: false });
    usd += res.usd;
    const raw = res.message.content ?? "";
    const parsed = schema.safeParse(parseJsonLoose(raw));
    if (parsed.success) return { value: parsed.data, usd };
    messages.push(res.message, { role: "user", content: `That JSON was invalid: ${parsed.error.message.slice(0, 500)}. Send the corrected JSON object only.` });
  }
  throw new Error("Model did not return valid JSON after a retry");
}

/** Parses JSON, tolerating a ```json fence or text around one object. */
export function parseJsonLoose(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
