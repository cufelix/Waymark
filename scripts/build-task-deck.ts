import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Occupation } from "../src/seeker/contracts.ts";
import { buildDeck, type DeckOccupationInput } from "../src/seeker/intake/deck-builder.ts";
import { OpenRouterClient } from "../src/seeker/llm/llm.ts";
import { exaFromEnv } from "../src/seeker/salary/exa.ts";
import { searchOccupations, slug } from "../src/shared/taxonomy/index.ts";

const DEFAULT_OCCUPATIONS: DeckOccupationInput[] = [
  { key: "backend", label: "Backend developer", kind: "coding" },
  { key: "frontend", label: "Frontend developer", kind: "web building" },
  { key: "data", label: "Data analyst", kind: "data" },
  { key: "qa", label: "QA tester", kind: "testing" },
  { key: "ux", label: "UX designer", kind: "design research" },
  { key: "sales", label: "Sales representative", kind: "sales" },
  { key: "marketing", label: "Marketing assistant", kind: "marketing" },
  { key: "project-coordination", label: "Project coordinator", kind: "organising" },
  { key: "customer-support", label: "Customer support specialist", kind: "customer support" },
  { key: "it-support", label: "IT support technician", kind: "technical support" },
  { key: "graphic-design", label: "Graphic designer", kind: "visual design" },
  { key: "accounting", label: "Accountant assistant", kind: "accounting" },
];

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(message?: string): never {
  const prefix = message ? `${message}\n` : "";
  throw new Error(`${prefix}Usage: node scripts/build-task-deck.ts --country CZ --out src/seeker/intake/decks/cz.json`);
}

async function resolveOccupation(label: string, lang: string): Promise<Occupation> {
  try {
    const matches = await searchOccupations(label, lang, 5);
    const exact = matches.find((match) => match.label.localeCompare(label, lang, { sensitivity: "base" }) === 0);
    if (exact) return exact;
    if (matches[0]) return matches[0];
  } catch {
    // The CLI can still build a clearly marked stub deck if ESCO is unavailable.
  }
  return { uri: `urn:stub:occupation:${slug(label)}`, label, lang };
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  for (let index = 0; index < args.length; index += 2) {
    if (!["--country", "--out"].includes(args[index] ?? "") || !args[index + 1] || args[index + 1]?.startsWith("--")) {
      usage("unknown or incomplete option");
    }
  }
  const country = option(args, "--country")?.toUpperCase();
  const out = option(args, "--out");
  if (!country || !/^[A-Z]{2}$/.test(country)) usage("--country must be an ISO alpha-2 code");
  if (!out) usage("--out is required");

  const exa = exaFromEnv();
  if (!exa) throw new Error("EXA_API_KEY is not set");
  const llm = new OpenRouterClient();
  let dropped = 0;
  const deck = await buildDeck({
    country,
    occupations: DEFAULT_OCCUPATIONS,
    exa,
    llm,
    resolveOccupation,
    now: () => new Date().toISOString(),
    onDrop: () => dropped++,
  });

  const outputPath = resolve(out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(deck, null, 2)}\n`, "utf8");

  process.stdout.write(`Built ${deck.country} task deck ${deck.version}\n`);
  for (const path of deck.paths) {
    process.stdout.write(`  ${path.key}: ${deck.cards.filter((card) => card.pathKey === path.key).length} cards\n`);
  }
  process.stdout.write(`Dropped: ${dropped}\n`);
  process.stdout.write(`Wrote: ${outputPath}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Task deck build failed"}\n`);
    process.exitCode = 1;
  });
}
