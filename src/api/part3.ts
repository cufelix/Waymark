// Mounts Part 3 (validation, src/gap, owner @Dymyt-ry) into this server so one process serves the whole API.
// Part 3 is framework-free and keeps its own conventions (.ts imports, node --test), so it is loaded with a
// dynamic import and typed here only by what this adapter uses.
import type { Context } from "hono";
import { apiKeys, config } from "../config";
import { pool } from "../db/pool";

type Part3Request = { method: string; path: string; headers: Record<string, string>; body?: unknown };
type Part3Response = { status: number; body: unknown };
type Part3 = { handle: (req: Part3Request, deps: unknown) => Promise<Part3Response> };

let loaded: Promise<{ part3: Part3; deps: unknown }> | undefined;

/** Builds Part 3's dependencies once: its store and a client for this server's Part 2 API. */
function load(): Promise<{ part3: Part3; deps: unknown }> {
  loaded ??= (async () => {
    const at = (path: string) => new URL(`../gap/${path}`, import.meta.url).href;
    const [part3, store, part2] = await Promise.all([
      import(at("api.ts")) as Promise<Part3>,
      import(at("postgres-store.ts")) as Promise<{
        PostgresGapStore: new (db: typeof pool, retentionDays?: number) => unknown;
      }>,
      import(at("part2-client.ts")) as Promise<{ HttpPart2Client: new (options: { baseUrl: string; apiKey: string }) => unknown }>,
    ]);
    return {
      part3,
      deps: {
        store: new store.PostgresGapStore(pool, config.PERSONAL_DATA_RETENTION_DAYS),
        part2: new part2.HttpPart2Client({
          baseUrl: process.env.PART2_BASE_URL ?? `http://127.0.0.1:${config.PORT}`,
          apiKey: apiKeys()[0] ?? "",
        }),
        apiKeys: apiKeys(),
      },
    };
  })();
  return loaded;
}

/** Hands one JSON request to Part 3 and returns its response as-is (it already uses the shared envelope). */
export async function part3Handler(c: Context): Promise<Response> {
  const { part3, deps } = await load();
  const type = c.req.header("content-type") ?? "";
  const body = type.includes("json") ? await c.req.json().catch(() => undefined) : undefined;
  const response = await part3.handle(
    { method: c.req.method, path: c.req.path, headers: Object.fromEntries(c.req.raw.headers), body },
    deps,
  );
  return c.json(response.body as object, response.status as 200);
}
