// The generic agent loop: the model calls tools until it calls `finish`, or the budget runs out.
import { chat, type ChatMessage, type ToolSpec } from "../llm";
import { clip, runTool, toolSpec, type Tool, type ToolResult } from "../tools/types";

export type CallRecord = { index: number; tool: string; params: Record<string, unknown>; result: ToolResult };

export type AgentRun<F> = {
  finished: F | null;            // the arguments the model passed to `finish`, or null if it never did
  calls: CallRecord[];
  usd: number;
  stopReason: "finished" | "max-steps" | "max-usd" | "no-tool-call";
};

export type AgentSpec<F> = {
  system: string;
  task: string;
  tools: Tool[];
  finish: { description: string; parameters: Record<string, unknown>; parse: (args: unknown) => F };
  maxSteps: number;
  maxUsd: number;
  model?: string;
  runId?: string;
};

export async function runAgent<F>(spec: AgentSpec<F>): Promise<AgentRun<F>> {
  const tools = spec.tools.filter((t) => t.available());
  const byName = new Map(tools.map((t) => [t.name, t]));
  const finishSpec: ToolSpec = {
    type: "function",
    function: { name: "finish", description: spec.finish.description, parameters: spec.finish.parameters },
  };
  const specs = [...tools.map(toolSpec), finishSpec];
  const messages: ChatMessage[] = [
    { role: "system", content: spec.system },
    { role: "user", content: spec.task },
  ];
  const calls: CallRecord[] = [];
  let usd = 0;

  for (let step = 0; step < spec.maxSteps; step++) {
    if (usd >= spec.maxUsd) return { finished: null, calls, usd, stopReason: "max-usd" };
    const res = await chat(messages, { tools: specs, model: spec.model, runId: spec.runId });
    usd += res.usd;
    messages.push(res.message);
    const toolCalls = res.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      messages.push({ role: "user", content: "Call a tool, or call `finish`." });
      continue;
    }
    for (const call of toolCalls) {
      const args = safeJson(call.function.arguments);
      if (call.function.name === "finish") {
        try {
          return { finished: spec.finish.parse(args), calls, usd, stopReason: "finished" };
        } catch (err) {
          messages.push({ role: "tool", tool_call_id: call.id, content: `finish rejected: ${String(err).slice(0, 400)}` });
          continue;
        }
      }
      const tool = byName.get(call.function.name);
      const result: ToolResult = tool
        ? await runTool(tool, args, { runId: spec.runId })
        : { ok: false, error: `Unknown tool ${call.function.name}`, usd: 0 };
      usd += result.usd;
      const index = calls.length;
      calls.push({ index, tool: call.function.name, params: args, result });
      const content = result.ok
        ? `call #${index} ok${result.url ? ` (${result.url})` : ""}:\n${clip(result.text)}`
        : `call #${index} failed: ${result.error}`;
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return { finished: null, calls, usd, stopReason: "max-steps" };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
