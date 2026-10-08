import type { Envelope } from "../seeker/core/errors.ts";
import type { RoadmapDeps } from "./service.ts";

export type RoadmapApiRequest = { method: string; path: string; headers?: Record<string, string>; body?: unknown };
export type RoadmapApiResponse = { status: number; body: Envelope<unknown> };
export type RoadmapApiDeps = RoadmapDeps & { apiKeys?: string[] };

/** Routes and envelopes every Part 4 endpoint using the shared API conventions. */
export async function handle(_req: RoadmapApiRequest, _deps: RoadmapApiDeps): Promise<RoadmapApiResponse> {
  throw new Error("not implemented");
}
