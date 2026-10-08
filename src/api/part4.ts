// Mounts Part 4 (roadmaps, src/roadmap, owner @Dymyt-ry) into this server so one process serves the whole API.
// Part 4 is framework-free and keeps its own conventions (.ts imports, node --test), so it is loaded with a
// dynamic import and typed here only by what this adapter uses.
import type { Context } from "hono";
import { apiKeys, config } from "../config";

type Part4Request = { method: string; path: string; headers: Record<string, string>; body?: unknown };
type Part4Response = { status: number; body: unknown };
type Part4 = { handle: (req: Part4Request, deps: unknown) => Promise<Part4Response> };

let loaded: Promise<{ part4: Part4; deps: unknown }> | undefined;

/** Builds Part 4's dependencies once: its stores, model/search clients, and a reader for this server's Part 3 API. */
function load(): Promise<{ part4: Part4; deps: unknown }> {
  loaded ??= (async () => {
    const roadmapAt = (path: string) => new URL(`../roadmap/${path}`, import.meta.url).href;
    const seekerAt = (path: string) => new URL(`../seeker/${path}`, import.meta.url).href;
    const [part4, store, resources, validations, llm, exa] = await Promise.all([
      import(roadmapAt("api.ts")) as Promise<Part4>,
      import(roadmapAt("store.ts")) as Promise<{ MemoryRoadmapStore: new () => unknown }>,
      import(roadmapAt("resources.ts")) as Promise<{ MemoryResourceCache: new () => unknown }>,
      import(roadmapAt("validation-client.ts")) as Promise<{
        HttpValidationReader: new (options: { baseUrl: string; apiKey: string }) => unknown;
      }>,
      import(seekerAt("llm/llm.ts")) as Promise<{ OpenRouterClient: new (key?: string) => unknown }>,
      import(seekerAt("salary/exa.ts")) as Promise<{ exaFromEnv: () => unknown }>,
    ]);
    const baseUrl = process.env.PART3_BASE_URL ?? `http://127.0.0.1:${config.PORT}`;
    const apiKey = apiKeys()[0] ?? "";
    return {
      part4,
      deps: {
        store: new store.MemoryRoadmapStore(),
        cache: new resources.MemoryResourceCache(),
        validations: new validations.HttpValidationReader({ baseUrl, apiKey }),
        llm: new llm.OpenRouterClient(config.OPENROUTER_API_KEY),
        exa: exa.exaFromEnv(),
        apiKeys: apiKeys(),
      },
    };
  })();
  return loaded;
}

/** Hands one JSON request to Part 4 and returns its response as-is (it already uses the shared envelope). */
export async function part4Handler(c: Context): Promise<Response> {
  const { part4, deps } = await load();
  const type = c.req.header("content-type") ?? "";
  const body = type.includes("json") ? await c.req.json().catch(() => undefined) : undefined;
  const response = await part4.handle(
    { method: c.req.method, path: c.req.path, headers: Object.fromEntries(c.req.raw.headers), body },
    deps,
  );
  return c.json(response.body as object, response.status as 200);
}
