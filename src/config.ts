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
  // Local UI bridge: requests must come from this machine.
  UI_LOCAL: z.enum(["0", "1"]).default("0").transform((v) => v === "1"),
  // Public fake-data demo bridge: requests must match this exact origin.
  UI_PUBLIC_ORIGIN: z.url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "must be an HTTP(S) origin")
    .transform((value) => new URL(value).origin)
    .optional(),
  // Trust Cloudflare's client IP header only when all public traffic actually comes through Cloudflare.
  TRUST_CLOUDFLARE: z.enum(["0", "1"]).default("0").transform((v) => v === "1"),
  // Behind a local reverse proxy (Traefik in Coolify): take the client IP from the last X-Forwarded-For hop.
  TRUST_PROXY: z.enum(["0", "1"]).default("0").transform((v) => v === "1"),
  // Keys the seekers' ownership proof tokens. Set a long random value in production; changing it invalidates existing tokens.
  PROOF_SECRET: z.string().min(16).default("dev-only-proof-secret-change-me"),
  PERSONAL_DATA_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  RETENTION_PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  DELETION_RETRY_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  RESOURCE_CACHE_TTL_HOURS: z.coerce.number().int().min(1).max(8760).default(168),

  OPENROUTER_API_KEY: optional,
  LLM_AGENT_MODEL: z.string().default("anthropic/claude-sonnet-5.5"),
  LLM_FAST_MODEL: z.string().default("anthropic/claude-haiku-5.5"),

  APIFY_TOKEN: optional,
  // Actors a person has vetted; they skip the usage check (still capped per run). Comma-separated "user/name".
  APIFY_ALLOWED_ACTORS: z.string().default(""),
  EXA_API_KEY: optional,
  FIRECRAWL_API_KEY: optional,
  GITHUB_TOKEN: optional,
  ELEVENLABS_API_KEY: optional,
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8MzCmL"),
  ELEVENLABS_TTS_MODEL: z.string().default("eleven_flash_v2_5"),

  CAP_LLM_USD: z.coerce.number().default(50),
  CAP_APIFY_USD: z.coerce.number().default(50),
  CAP_EXA_USD: z.coerce.number().default(50),
  CAP_FIRECRAWL_USD: z.coerce.number().default(50),
  CAP_ELEVENLABS_CHARS_PER_DAY: z.coerce.number().int().min(1).default(20_000),

  // ponytail: flat estimate per Firecrawl credit, replace with the plan's real rate
  FIRECRAWL_USD_PER_CREDIT: z.coerce.number().default(0.001),

  AGENT_MAX_STEPS: z.coerce.number().int().default(8),
  AGENT_MAX_USD: z.coerce.number().default(0.15),
});

export type Config = z.infer<typeof Env>;
export const config: Config = Env.parse(process.env);

// A public UI signs seeker sessions with PROOF_SECRET and forwards with the API keys, so neither may be a default.
if (config.UI_PUBLIC_ORIGIN && !process.env.VITEST) {
  if (config.PROOF_SECRET.startsWith("dev-only")) throw new Error("UI_PUBLIC_ORIGIN is set but PROOF_SECRET is the development default");
  if (config.API_KEYS.split(",").some((k) => k.trim() === "dev-key-change-me")) throw new Error("UI_PUBLIC_ORIGIN is set but API_KEYS contains the example key");
  // Behind a reverse proxy that connects from loopback, "Host: localhost" would otherwise reach the full-key local bridge.
  if (config.UI_LOCAL) throw new Error("UI_PUBLIC_ORIGIN and UI_LOCAL=1 can't be combined");
}

export const apiKeys = (): string[] =>
  config.API_KEYS.split(",").map((k) => k.trim()).filter(Boolean);
