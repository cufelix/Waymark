// Framework-free entry point for every Part 3 endpoint (API.md "Part 3: Validation"), same shape as src/seeker/api.ts.
// Owner: worker service. src/api/part3.ts mounts it into the server.
import type { Envelope } from "../seeker/core/errors.ts";
import type { GapStore } from "./store.ts";
import type { Part2Client } from "./part2-client.ts";

export type GapRequest = { method: string; path: string; headers?: Record<string, string>; body?: unknown };
export type GapResponse = { status: number; body: Envelope<unknown> };
export type GapDeps = { store: GapStore; part2: Part2Client; apiKeys?: string[] };

export async function handle(_req: GapRequest, _deps: GapDeps): Promise<GapResponse> {
  throw new Error("not implemented");
}
