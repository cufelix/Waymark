import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env") && !process.env.VITEST) process.loadEnvFile(".env");

const optional = z.string().trim().min(1).optional().catch(undefined);

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://research:research@localhost:5433/research"),
  PORT: z.coerce.number().int().default(8787),
  API_KEYS: z.string().default(""),
  SNAPSHOT_DIR: z.string().default("./data/snapshots"),
  ROLE: z.enum(["all", "api", "worker"]).default("all"),

  OPENROUTER_API_KEY: optional,
  LLM_AGENT_MODEL: z.string().default("anthropic/claude-sonnet-5.5"),
  LLM_FAST_MODEL: z.string().default("anthropic/claude-haiku-5.5"),

  APIFY_TOKEN: optional,
  EXA_API_KEY: optional,
  FIRECRAWL_API_KEY: optional,
  GITHUB_TOKEN: optional,

  CAP_LLM_USD: z.coerce.number().default(50),
  CAP_APIFY_USD: z.coerce.number().default(50),
  CAP_EXA_USD: z.coerce.number().default(50),
  CAP_FIRECRAWL_USD: z.coerce.number().default(50),

  // ponytail: flat estimate per Firecrawl credit, replace with the plan's real rate
  FIRECRAWL_USD_PER_CREDIT: z.coerce.number().default(0.001),

  AGENT_MAX_STEPS: z.coerce.number().int().default(8),
  AGENT_MAX_USD: z.coerce.number().default(0.15),
});

export type Config = z.infer<typeof Env>;
export const config: Config = Env.parse(process.env);

export const apiKeys = (): string[] =>
  config.API_KEYS.split(",").map((k) => k.trim()).filter(Boolean);
