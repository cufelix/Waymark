// Mounts Part 1 (user input, src/seeker, owner @Dymyt-ry) into this server so one process serves the whole API.
// Part 1 is framework-free and keeps its own conventions (.ts imports, node --test), so it is loaded with a
// dynamic import and typed here only by what this adapter uses.
import type { Context } from "hono";
import { apiKeys, config } from "../config";

type UploadedFile = { fileName: string; mimeType: string; bytes: Uint8Array; kind?: string };
type Part1Request = { method: string; path: string; headers: Record<string, string>; body?: unknown; file?: UploadedFile };
type Part1Response = { status: number; body: unknown };
type Part1 = { handle: (req: Part1Request, deps: unknown) => Promise<Part1Response> };

let loaded: Promise<{ part1: Part1; deps: unknown }> | undefined;

/** Builds Part 1's dependencies once: its store, its model client, and a client for this server's Part 2 API. */
function load(): Promise<{ part1: Part1; deps: unknown }> {
  loaded ??= (async () => {
    const at = (p: string) => new URL(`../seeker/${p}`, import.meta.url).href;
    const [part1, store, llm, research, validation, roadmap] = await Promise.all([
      import(at("api.ts")) as Promise<Part1>,
      import(at("store/memory.ts")) as Promise<{ MemoryStore: new () => unknown }>,
      import(at("llm/llm.ts")) as Promise<{ OpenRouterClient: new (key?: string) => unknown }>,
      import(at("research-client.ts")) as Promise<{ HttpResearchClient: new (o: { baseUrl: string; apiKey: string }) => unknown }>,
      import(at("validation-client.ts")) as Promise<{ HttpValidationClient: new (o: { baseUrl: string; apiKey: string }) => unknown }>,
      import(at("roadmap-client.ts")) as Promise<{ HttpRoadmapClient: new (o: { baseUrl: string; apiKey: string }) => unknown }>,
    ]);
    const baseUrl = process.env.PART2_BASE_URL ?? `http://127.0.0.1:${config.PORT}`;
    const apiKey = apiKeys()[0] ?? "";
    return {
      part1,
      deps: {
        // ponytail: Part 1's in-memory store loses seekers on restart; swap in a Postgres SeekerStore before real users
        store: new store.MemoryStore(),
        llm: new llm.OpenRouterClient(config.OPENROUTER_API_KEY),
        // Part 1 checks career choices and cascades GDPR deletes against Part 2 over HTTP; here that's this server.
        research: new research.HttpResearchClient({ baseUrl, apiKey }),
        validations: new validation.HttpValidationClient({ baseUrl, apiKey }),
        roadmaps: new roadmap.HttpRoadmapClient({ baseUrl, apiKey }),
        apiKeys: apiKeys(),
      },
    };
  })();
  return loaded;
}

/** Hands one request to Part 1 and returns its response as-is (it already uses the shared envelope). */
export async function part1Handler(c: Context): Promise<Response> {
  const { part1, deps } = await load();
  const type = c.req.header("content-type") ?? "";
  let body: unknown;
  let file: UploadedFile | undefined;
  if (type.startsWith("multipart/form-data")) {
    const form = await c.req.parseBody();
    const f = form.file;
    const kind = form.kind;
    if (f instanceof File) {
      file = {
        fileName: f.name,
        mimeType: f.type,
        bytes: new Uint8Array(await f.arrayBuffer()),
        // A non-string kind (e.g. a file) becomes "", which Part 1 rejects as unprocessable instead of defaulting to "cv".
        ...(kind === undefined ? {} : { kind: typeof kind === "string" ? kind : "" }),
      };
    }
  } else if (type.includes("json")) {
    body = await c.req.json().catch(() => undefined);
  }
  const res = await part1.handle({ method: c.req.method, path: c.req.path, headers: Object.fromEntries(c.req.raw.headers), body, file }, deps);
  return c.json(res.body as object, res.status as 200);
}
