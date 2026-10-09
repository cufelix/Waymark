import { authenticate, parseApiKeys, type Headers } from "./core/auth.ts";
import { errorMessage, log } from "../log.ts";
import { ApiError, fail, ok, type Envelope } from "./core/errors.ts";
import { newId } from "./core/ids.ts";
import { validateCareerChoice, validateCreateSeeker, validateInterviewMessage, validateLinks, validatePreferences } from "./core/validate.ts";
import { loadDeck } from "./intake/deck.ts";
import {
  answerWarmup,
  finishChatWhenDone,
  getIntake,
  moreCards,
  rateCard,
  setPractical,
  skipChat,
  type IntakeDeps,
} from "./intake/service.ts";
import type { LlmClient } from "./llm/llm.ts";
import type { ResearchClient } from "./research-client.ts";
import type { RoadmapClient } from "./roadmap-client.ts";
import { exaFromEnv, type ExaClient } from "./salary/exa.ts";
import { setCareerChoice } from "./service/career-choice.ts";
import { deleteDocument, uploadCv } from "./service/documents.ts";
import { deleteSeeker, exportSeeker } from "./service/gdpr.ts";
import { getInterview, interviewTurn } from "./service/interview.ts";
import { createSeeker, getProfile, loadSeeker, putLinks, setPreferences } from "./service/seekers.ts";
import type { SeekerStore } from "./store/store.ts";
import type { ValidationClient } from "./validation-client.ts";

// One framework-free entry point for every Part 1 endpoint (API.md "Part 1: User input").
// A Next.js route (or any HTTP server) parses JSON / multipart and calls handle().

export type UploadedFile = { fileName: string; mimeType: string; bytes: Uint8Array; kind?: string };

export type ApiRequest = {
  method: string;
  path: string; // "/v1/seekers/skr_…/profile", a query string is ignored
  headers: Headers;
  body?: unknown; // parsed JSON body
  file?: UploadedFile; // multipart `file` plus optional string field `kind`
};

export type ApiResponse = { status: number; body: Envelope<unknown> };

export type ApiDeps = {
  store: SeekerStore;
  llm: LlmClient;
  exa?: ExaClient | null;
  research: ResearchClient;
  validations?: ValidationClient;
  roadmaps?: RoadmapClient;
  intake?: Partial<Pick<IntakeDeps, "loadDeck" | "engine" | "warmupFreeText">>;
  apiKeys?: string[]; // default: env SEEKER_API_KEYS
};

type Params = { seekerId: string; documentId?: string; cardId?: string };
type Handler = (req: ApiRequest, deps: ApiDeps, params: Params) => Promise<unknown>;
type Route = { method: string; pattern: RegExp; status?: number; seekerScoped?: boolean; handler: Handler };

const SEEKER = "(skr_[0-9A-HJKMNP-TV-Z]{26})";
const DOCUMENT = "(doc_[0-9A-HJKMNP-TV-Z]{26})";
const CARD = "(crd_[0-9A-HJKMNP-TV-Z]{26})";
const route = (path: string): RegExp => new RegExp(
  `^${path.replace("{seekerId}", SEEKER).replace("{documentId}", DOCUMENT).replace("{cardId}", CARD)}$`,
);

const intakeDeps = (deps: ApiDeps): IntakeDeps => ({
  store: deps.store,
  llm: deps.llm,
  loadDeck: deps.intake?.loadDeck ?? loadDeck,
  ...(deps.intake?.engine ? { engine: deps.intake.engine } : {}),
  ...(deps.intake?.warmupFreeText ? { warmupFreeText: deps.intake.warmupFreeText } : {}),
});

function requireEmptyBody(body: unknown): void {
  if (body === undefined) return;
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length > 0) {
    throw new ApiError("unprocessable", "body: must be empty");
  }
}

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
    // undefined = the host passed no Exa client (e.g. src/api/part1.ts), so take it from EXA_API_KEY; null = off.
    handler: async (req, deps, p) => {
      const result = await interviewTurn(
        { ...deps, exa: deps.exa === undefined ? exaFromEnv() : deps.exa },
        p.seekerId,
        validateInterviewMessage(req.body).text,
      );
      if (result.done) await finishChatWhenDone(intakeDeps(deps), p.seekerId);
      return result;
    },
  },
  { method: "GET", pattern: route("/v1/seekers/{seekerId}/interview"), seekerScoped: true, handler: async (_r, deps, p) => getInterview(deps, p.seekerId) },
  {
    method: "GET",
    pattern: route("/v1/seekers/{seekerId}/intake"),
    seekerScoped: true,
    handler: async (_req, deps, p) => getIntake(intakeDeps(deps), p.seekerId),
  },
  {
    method: "POST",
    pattern: route("/v1/seekers/{seekerId}/intake/warmup"),
    seekerScoped: true,
    handler: async (req, deps, p) => answerWarmup(intakeDeps(deps), p.seekerId, req.body),
  },
  {
    method: "POST",
    pattern: route("/v1/seekers/{seekerId}/intake/cards/{cardId}/rating"),
    seekerScoped: true,
    handler: async (req, deps, p) => rateCard(intakeDeps(deps), p.seekerId, p.cardId!, req.body),
  },
  {
    method: "POST",
    pattern: route("/v1/seekers/{seekerId}/intake/cards/more"),
    seekerScoped: true,
    handler: async (req, deps, p) => {
      requireEmptyBody(req.body);
      return moreCards(intakeDeps(deps), p.seekerId);
    },
  },
  {
    method: "POST",
    pattern: route("/v1/seekers/{seekerId}/intake/chat/skip"),
    seekerScoped: true,
    handler: async (req, deps, p) => {
      requireEmptyBody(req.body);
      return skipChat(intakeDeps(deps), p.seekerId);
    },
  },
  {
    method: "PUT",
    pattern: route("/v1/seekers/{seekerId}/intake/practical"),
    seekerScoped: true,
    handler: async (req, deps, p) => setPractical(intakeDeps(deps), p.seekerId, req.body),
  },
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
    if (r.method === method) {
      return {
        route: r,
        params: {
          seekerId: m[1],
          ...(r.pattern.source.includes("doc_") ? { documentId: m[2] } : {}),
          ...(r.pattern.source.includes("crd_") ? { cardId: m[2] } : {}),
        },
      };
    }
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
    if (!(err instanceof ApiError)) log.error("part 1 request failed", { requestId, error: errorMessage(err) });
    return fail(err, requestId);
  }
}
