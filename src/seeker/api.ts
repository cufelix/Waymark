import { authenticate, parseApiKeys, type Headers } from "./core/auth.ts";
import { ApiError, fail, ok, type Envelope } from "./core/errors.ts";
import { newId } from "./core/ids.ts";
import { validateCareerChoice, validateCreateSeeker, validateInterviewMessage, validateLinks, validatePreferences } from "./core/validate.ts";
import type { LlmClient } from "./llm/llm.ts";
import type { ResearchClient } from "./research-client.ts";
import type { ExaClient } from "./salary/exa.ts";
import { setCareerChoice } from "./service/career-choice.ts";
import { deleteDocument, uploadCv } from "./service/documents.ts";
import { deleteSeeker, exportSeeker } from "./service/gdpr.ts";
import { getInterview, interviewTurn } from "./service/interview.ts";
import { createSeeker, getProfile, loadSeeker, putLinks, setPreferences } from "./service/seekers.ts";
import type { SeekerStore } from "./store/store.ts";

// One framework-free entry point for every Part 1 endpoint (API.md "Part 1: User input").
// A Next.js route (or any HTTP server) parses JSON / multipart and calls handle().

export type UploadedFile = { fileName: string; mimeType: string; bytes: Uint8Array };

export type ApiRequest = {
  method: string;
  path: string; // "/v1/seekers/skr_…/profile", a query string is ignored
  headers: Headers;
  body?: unknown; // parsed JSON body
  file?: UploadedFile; // multipart field `file` (CV upload)
};

export type ApiResponse = { status: number; body: Envelope<unknown> };

export type ApiDeps = {
  store: SeekerStore;
  llm: LlmClient;
  exa?: ExaClient | null;
  research: ResearchClient;
  apiKeys?: string[]; // default: env SEEKER_API_KEYS
};

type Params = { seekerId: string; documentId?: string };
type Handler = (req: ApiRequest, deps: ApiDeps, params: Params) => Promise<unknown>;
type Route = { method: string; pattern: RegExp; status?: number; seekerScoped?: boolean; handler: Handler };

const SEEKER = "(skr_[0-9A-HJKMNP-TV-Z]{26})";
const DOCUMENT = "(doc_[0-9A-HJKMNP-TV-Z]{26})";
const route = (path: string): RegExp => new RegExp(`^${path.replace("{seekerId}", SEEKER).replace("{documentId}", DOCUMENT)}$`);

// seekerScoped: the seeker must exist and not be deletion-pending before the handler runs.
// Export and delete handle deletion-pending themselves, so they are not marked.
const ROUTES: Route[] = [
  { method: "POST", pattern: route("/v1/seekers"), status: 201, handler: async (req, deps) => createSeeker(deps, validateCreateSeeker(req.body).consent) },
  {
    method: "PUT",
    pattern: route("/v1/seekers/{seekerId}/preferences"),
    seekerScoped: true,
    handler: async (req, deps, p) => setPreferences(deps, p.seekerId, validatePreferences(req.body)),
  },
  {
    method: "PUT",
    pattern: route("/v1/seekers/{seekerId}/links"),
    seekerScoped: true,
    handler: async (req, deps, p) => putLinks(deps, p.seekerId, validateLinks(req.body)),
  },
  {
    method: "PUT",
    pattern: route("/v1/seekers/{seekerId}/career-choice"),
    seekerScoped: true,
    handler: async (req, deps, p) => setCareerChoice(deps, p.seekerId, validateCareerChoice(req.body)),
  },
  { method: "GET", pattern: route("/v1/seekers/{seekerId}/profile"), seekerScoped: true, handler: async (_r, deps, p) => getProfile(deps, p.seekerId) },
  { method: "GET", pattern: route("/v1/seekers/{seekerId}/export"), handler: async (_r, deps, p) => exportSeeker(deps, p.seekerId) },
  { method: "DELETE", pattern: route("/v1/seekers/{seekerId}"), handler: async (_r, deps, p) => deleteSeeker(deps, p.seekerId) },

  {
    method: "POST",
    pattern: route("/v1/seekers/{seekerId}/interview/messages"),
    seekerScoped: true,
    handler: async (req, deps, p) => interviewTurn(deps, p.seekerId, validateInterviewMessage(req.body).text),
  },
  { method: "GET", pattern: route("/v1/seekers/{seekerId}/interview"), seekerScoped: true, handler: async (_r, deps, p) => getInterview(deps, p.seekerId) },
  {
    method: "POST",
    pattern: route("/v1/seekers/{seekerId}/documents"),
    status: 201,
    seekerScoped: true,
    handler: async (req, deps, p) => {
      if (!req.file) throw new ApiError("unprocessable", "file: multipart field is required");
      return uploadCv(deps, p.seekerId, req.file);
    },
  },
  {
    method: "DELETE",
    pattern: route("/v1/seekers/{seekerId}/documents/{documentId}"),
    seekerScoped: true,
    handler: async (_r, deps, p) => deleteDocument(deps, p.seekerId, p.documentId!),
  },
];

// Paths that look like Part 1 routes but carry a malformed id answer not_found, like unknown ids.
function matchRoute(method: string, path: string): { route: Route; params: Params } {
  let pathMatched = false;
  for (const r of ROUTES) {
    const m = r.pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method === method) return { route: r, params: { seekerId: m[1], documentId: m[2] } };
  }
  if (pathMatched) throw new ApiError("bad_request", `Method ${method} is not allowed on ${path}`);
  throw new ApiError("not_found", `No route for ${method} ${path}`);
}

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const requestId = newId("req");
  try {
    authenticate(req.headers ?? {}, deps.apiKeys ?? parseApiKeys());
    const path = (req.path.split("?")[0] || "/").replace(/(.)\/+$/, "$1");
    const { route: r, params } = matchRoute(req.method.toUpperCase(), path);
    if (r.seekerScoped) await loadSeeker(deps, params.seekerId);
    const data = await r.handler(req, deps, params);
    return { status: r.status ?? 200, body: ok(data, requestId) };
  } catch (err) {
    if (!(err instanceof ApiError)) console.error(`[seeker-api] ${requestId}`, err);
    return fail(err, requestId);
  }
}
