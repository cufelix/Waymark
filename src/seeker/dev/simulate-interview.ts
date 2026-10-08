// Dev harness for the intake interview: runs the REAL interviewTurn() against the real model.
//   node src/seeker/dev/simulate-interview.ts --persona a [--version 1] [--out DIR]
//   node src/seeker/dev/simulate-interview.ts --persona all
//   node src/seeker/dev/simulate-interview.ts --interactive      (you type the answers)
// Needs OPENROUTER_API_KEY in the environment. Not part of the shipped service.
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import type { SeekerProfile } from "../contracts.ts";
import { now } from "../core/claims.ts";
import { emptyPreferences } from "../core/profile.ts";
import type { ChatRequest, LlmClient } from "../llm/llm.ts";
import { MODELS, OpenRouterClient } from "../llm/llm.ts";
import { MemoryStore } from "../store/memory.ts";
import { interviewTurn } from "../service/interview.ts";

const PERSONAS: Record<string, { name: string; brief: string }> = {
  a: {
    name: "cz-junior-backend",
    brief:
      "You are Jakub, 22, a Czech computer-science student finishing a bachelor's degree, living in Prague. You want a junior backend developer job (Node.js/TypeScript, some Python, PostgreSQL, Docker). You answer in Czech, casually, 1-2 sentences. You prefer Prague or remote, hybrid is fine, want to learn fast, would love to work at Kiwi.com or Mailstep, hate unpaid overtime and outsourcing body-shopping. You speak Czech natively and English at a working level, a bit of German. Expected salary about 55 000 CZK per month, but you only say it if asked.",
  },
  b: {
    name: "cz-nurse-switcher",
    brief:
      "You are Lenka, 31, a nurse from Brno who is burnt out and thinking of changing careers. You are vague and unsure: you say things like 'nevím, asi něco jiného' and 'něco s lidma, ale ne nemocnice' until offered concrete options, then you pick one half-heartedly (e.g. you are curious about UX research or HR but not sure). You answer in Czech, short. You live in Brno, would like to stay in Czechia, remote would be nice. Stability matters to you because you have a child. You speak Czech natively, English basic. You are good with patients, communication, stress, and Excel. You have no strong salary number.",
  },
  c: {
    name: "en-designer-berlin",
    brief:
      "You are Sam, 27, a product designer in Berlin (Figma, design systems, user research). You answer in English with terse answers, a few words, never volunteering extra. You want a product designer role in Berlin or anywhere remote in the EU, care about meaningful work (climate or health tech), dream companies are Vinted and Doctolib, deal breakers are crunch culture and no design team. English is fluent, German working, Czech none. You want at least 60k EUR per year but only say it if asked.",
  },
};

class CountingLlm implements LlmClient {
  inner: LlmClient;
  calls = 0;
  constructor(inner: LlmClient) {
    this.inner = inner;
  }
  async chat(req: ChatRequest): Promise<string> {
    this.calls++;
    return this.inner.chat(req);
  }
}

function newProfile(seekerId: string): SeekerProfile {
  return {
    seekerId,
    profileVersion: 1,
    status: "incomplete",
    consent: { dataProcessing: true, nameSearch: false, givenAt: now(), policyVersion: "dev" },
    preferences: emptyPreferences(),
    statedSkills: [],
    documents: [],
    links: [],
    updatedAt: now(),
  };
}

async function seekerReply(llm: LlmClient, brief: string, history: { role: "agent" | "seeker"; text: string }[]): Promise<string> {
  const system =
    `You role-play a job seeker talking to a career-advisor chatbot. ${brief}\n` +
    "Stay in character. Reply ONLY with your next chat message, nothing else. Never mention you are role-playing.";
  const messages = history.map((t) => ({
    role: (t.role === "agent" ? "user" : "assistant") as "user" | "assistant",
    content: t.text,
  }));
  return (await llm.chat({ model: MODELS.fast, messages: [{ role: "system", content: system }, ...messages], temperature: 0.7 })).trim();
}

async function run(opts: { persona?: string; interactive: boolean; maxTurns: number; quiet?: boolean }) {
  const log = (s: string) => { if (!opts.quiet) console.log(s); };
  const counting = new CountingLlm(new OpenRouterClient());
  const store = new MemoryStore();
  const seekerId = "skr_dev";
  await store.create({ profile: newProfile(seekerId), interview: [], draft: {}, cvTexts: {} });
  const deps = { store, llm: counting };
  const rl = opts.interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;

  const first = await interviewTurn(deps, seekerId, "");
  let reply = first.reply;
  let done = false;
  log(`\nAGENT: ${reply}`);
  const history: { role: "agent" | "seeker"; text: string }[] = [{ role: "agent", text: reply }];

  for (let i = 0; i < opts.maxTurns && !done; i++) {
    const text = rl
      ? (await rl.question("\nYOU: ")).trim()
      : await seekerReply(counting, PERSONAS[opts.persona!].brief, history);
    if (rl && text === "") break;
    if (!rl) log(`\nSEEKER: ${text}`);
    history.push({ role: "seeker", text });
    const out = await interviewTurn(deps, seekerId, text);
    reply = out.reply;
    done = out.done;
    history.push({ role: "agent", text: reply });
    log(`\nAGENT: ${reply}${done ? "  [done]" : ""}`);
  }
  rl?.close();

  const record = (await store.get(seekerId))!;
  return { history, done, draft: record.draft, skills: record.profile.statedSkills, preferences: record.profile.preferences, calls: counting.calls };
}

function toMarkdown(title: string, r: Awaited<ReturnType<typeof run>>): string {
  const lines = [`# ${title}`, "", `done=${r.done}, agent questions=${r.history.filter((t) => t.role === "agent").length}, model calls=${r.calls}`, "", "## Transcript", ""];
  for (const t of r.history) lines.push(`**${t.role === "agent" ? "Agent" : "Seeker"}:** ${t.text}`, "");
  lines.push("## Draft preferences", "", "```json", JSON.stringify(r.draft, null, 2), "```", "", "## statedSkills", "");
  if (r.skills.length === 0) lines.push("(none)");
  for (const c of r.skills) lines.push(`- ${c.skill?.label ?? c.statement} — "${c.sources[0]?.quote ?? ""}"`);
  return lines.join("\n") + "\n";
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const interactive = process.argv.includes("--interactive");
const maxTurns = Number(arg("max-turns") ?? 12);
if (interactive) {
  await run({ interactive: true, maxTurns: 30 });
} else {
  const which = arg("persona") ?? "all";
  const keys = which === "all" ? Object.keys(PERSONAS) : [which];
  const version = arg("version") ?? "dev";
  const outDir = arg("out");
  if (outDir) mkdirSync(outDir, { recursive: true });
  await Promise.all(
    keys.map(async (key) => {
      if (!PERSONAS[key]) throw new Error(`unknown persona ${key} (a, b, c, all)`);
      const r = await run({ persona: key, interactive: false, maxTurns, quiet: keys.length > 1 });
      const md = toMarkdown(`${PERSONAS[key].name} v${version}`, r);
      if (outDir) writeFileSync(join(outDir, `${PERSONAS[key].name}-v${version}.md`), md);
    }),
  );
}
