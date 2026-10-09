import type { Envelope } from "../seeker/core/errors.ts";
import { authenticate, parseApiKeys } from "../seeker/core/auth.ts";
import { errorMessage, log } from "../log.ts";
import { ApiError, fail, ok } from "../seeker/core/errors.ts";
import { newId } from "../seeker/core/ids.ts";
import type { RoadmapProgress, RoadmapRequest } from "./contracts.ts";
import {
  createRoadmap,
  defaultBuilders,
  deleteRoadmaps,
  getRoadmap,
  listRoadmaps,
  setProgress,
  type RoadmapBuilders,
  type RoadmapDeps,
} from "./service.ts";

export type RoadmapApiRequest = { method: string; path: string; headers?: Record<string, string>; body?: unknown };
export type RoadmapApiResponse = { status: number; body: Envelope<unknown> };
export type RoadmapApiDeps = RoadmapDeps & { apiKeys?: string[]; builders?: RoadmapBuilders };

type Params = { roadmapId?: string; chapterId?: string; seekerId?: string };
type Handler = (req: RoadmapApiRequest, deps: RoadmapApiDeps, params: Params) => Promise<unknown>;
type Route = { method: string; pattern: RegExp; status?: number; params: (match: RegExpExecArray) => Params; handler: Handler };

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
const route = (path: string): RegExp => new RegExp(`^${path}$`);

const ROUTES: Route[] = [
  {
    method: "POST",
    pattern: route("/v1/roadmaps"),
    status: 202,
    params: () => ({}),
    handler: (req, deps) => createRoadmap(deps, req.body as RoadmapRequest, deps.builders ?? defaultBuilders),
  },
  {
    method: "GET",
    pattern: route(`/v1/roadmaps/(rmp_${ULID})`),
    params: (match) => ({ roadmapId: match[1] }),
    handler: (_req, deps, params) => getRoadmap(deps, params.roadmapId!),
  },
  {
    method: "PUT",
    pattern: route(`/v1/roadmaps/(rmp_${ULID})/chapters/(chp_${ULID})/progress`),
    params: (match) => ({ roadmapId: match[1], chapterId: match[2] }),
    handler: (req, deps, params) => setProgress(deps, params.roadmapId!, params.chapterId!, req.body as RoadmapProgress),
  },
  {
    method: "GET",
    pattern: route(`/v1/seekers/(skr_${ULID})/roadmaps`),
    params: (match) => ({ seekerId: match[1] }),
    handler: (_req, deps, params) => listRoadmaps(deps, params.seekerId!),
  },
  {
    method: "DELETE",
    pattern: route(`/v1/seekers/(skr_${ULID})/roadmaps`),
    params: (match) => ({ seekerId: match[1] }),
    handler: (_req, deps, params) => deleteRoadmaps(deps, params.seekerId!),
  },
];

function matchRoute(method: string, path: string): { route: Route; params: Params } {
  let pathMatched = false;
  for (const candidate of ROUTES) {
    const match = candidate.pattern.exec(path);
    if (!match) continue;
    pathMatched = true;
    if (candidate.method === method) return { route: candidate, params: candidate.params(match) };
  }
  if (pathMatched) throw new ApiError("bad_request", `Method ${method} is not allowed on ${path}`);
  throw new ApiError("not_found", `No route for ${method} ${path}`);
}

/** Routes and envelopes every Part 4 endpoint using the shared API conventions. */
export async function handle(req: RoadmapApiRequest, deps: RoadmapApiDeps): Promise<RoadmapApiResponse> {
  const requestId = newId("req");
  try {
    authenticate(req.headers ?? {}, deps.apiKeys ?? parseApiKeys());
    const path = (req.path.split("?")[0] || "/").replace(/(.)\/+$/, "$1");
    const { route: matched, params } = matchRoute(req.method.toUpperCase(), path);
    const data = await matched.handler(req, deps, params);
    return { status: matched.status ?? 200, body: ok(data, requestId) };
  } catch (error) {
    if (!(error instanceof ApiError)) log.error("part 4 request failed", { requestId, error: errorMessage(error) });
    return fail(error, requestId);
  }
}
