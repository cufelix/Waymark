// Framework-free entry point for every Part 3 endpoint (API.md "Part 3: Validation"), same shape as src/seeker/api.ts.
// Owner: worker service. src/api/part3.ts mounts it into the server.
import type { Envelope } from "../seeker/core/errors.ts";
import { authenticate, parseApiKeys } from "../seeker/core/auth.ts";
import { errorMessage, log } from "../log.ts";
import { ApiError, fail, ok } from "../seeker/core/errors.ts";
import { newId } from "../seeker/core/ids.ts";
import type { ValidationRequest } from "./contracts.ts";
import type { GapStore } from "./store.ts";
import type { Part2Client } from "./part2-client.ts";
import { createValidation, deleteValidations, getValidation, listValidations } from "./service.ts";

export type GapRequest = { method: string; path: string; headers?: Record<string, string>; body?: unknown };
export type GapResponse = { status: number; body: Envelope<unknown> };
export type GapDeps = { store: GapStore; part2: Part2Client; apiKeys?: string[] };

type Params = { validationId?: string; seekerId?: string };
type Handler = (req: GapRequest, deps: GapDeps, params: Params) => Promise<unknown>;
type Route = { method: string; pattern: RegExp; status?: number; handler: Handler };

const SEEKER = "(skr_[0-9A-HJKMNP-TV-Z]{26})";
const VALIDATION = "(val_[0-9A-HJKMNP-TV-Z]{26})";
const route = (path: string): RegExp => new RegExp(`^${path.replace("{seekerId}", SEEKER).replace("{validationId}", VALIDATION)}$`);

const ROUTES: Route[] = [
  { method: "POST", pattern: route("/v1/validations"), status: 201, handler: (req, deps) => createValidation(deps, req.body as ValidationRequest) },
  { method: "GET", pattern: route("/v1/validations/{validationId}"), handler: (_req, deps, params) => getValidation(deps, params.validationId!) },
  { method: "GET", pattern: route("/v1/seekers/{seekerId}/validations"), handler: (_req, deps, params) => listValidations(deps, params.seekerId!) },
  { method: "DELETE", pattern: route("/v1/seekers/{seekerId}/validations"), handler: (_req, deps, params) => deleteValidations(deps, params.seekerId!) },
];

function matchRoute(method: string, path: string): { route: Route; params: Params } {
  let pathMatched = false;
  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    pathMatched = true;
    if (route.method === method) {
      return {
        route,
        params: path.startsWith("/v1/validations/") ? { validationId: match[1] } : { seekerId: match[1] },
      };
    }
  }
  if (pathMatched) throw new ApiError("bad_request", `Method ${method} is not allowed on ${path}`);
  throw new ApiError("not_found", `No route for ${method} ${path}`);
}

export async function handle(req: GapRequest, deps: GapDeps): Promise<GapResponse> {
  const requestId = newId("req");
  try {
    authenticate(req.headers ?? {}, deps.apiKeys ?? parseApiKeys());
    const path = (req.path.split("?")[0] || "/").replace(/(.)\/+$/, "$1");
    const { route, params } = matchRoute(req.method.toUpperCase(), path);
    const data = await route.handler(req, deps, params);
    return { status: route.status ?? 200, body: ok(data, requestId) };
  } catch (error) {
    if (!(error instanceof ApiError)) log.error("part 3 request failed", { requestId, error: errorMessage(error) });
    return fail(error, requestId);
  }
}
