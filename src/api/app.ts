// Part 2 HTTP API, as specified in API.md: one envelope, Bearer API keys, fixed error codes.
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { apiKeys } from "../config";
import { StartRunBody } from "../contracts";
import { newId } from "../ids";
import { errorMessage, log } from "../log";
import { part1Handler } from "./part1";
import { part3Handler } from "./part3";
import { part4Handler } from "./part4";
import { mountUi } from "./ui";
import { mountVoice, type VoiceConfig, voiceConfig } from "./voice";
import { deleteResearchForSeeker, deleteRun, listRunsForSeeker } from "../research/gdpr";
import { getCompany, getVacancy, listRunCompanies, listRunVacancies } from "../research/market/read";
import { RunError, getRun, getRunRow, startRun } from "../research/run";

type ErrorCode =
  | "bad_request" | "unauthorized" | "consent_required" | "not_found" | "conflict"
  | "unprocessable" | "rate_limited" | "upstream_failed" | "internal";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400, unauthorized: 401, consent_required: 403, not_found: 404, conflict: 409,
  unprocessable: 422, rate_limited: 429, upstream_failed: 502, internal: 500,
};

type Env = { Variables: { requestId: string; apiKey: string } };
type Ctx = Context<Env>;
type Meta = Record<string, unknown>;

const ok = (c: Ctx, data: unknown, meta: Meta = {}, status: ContentfulStatusCode = 200) =>
  c.json({ ok: true, data, error: null, meta: { requestId: c.get("requestId"), ...meta } }, status);

const fail = (c: Ctx, code: ErrorCode, message: string) =>
  c.json({ ok: false, data: null, error: { code, message }, meta: { requestId: c.get("requestId") } }, STATUS[code]);

const zodMessage = (err: z.ZodError): string =>
  err.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");

const Paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function createApp({ rateLimitPerMinute = 60, voice = voiceConfig() }: { rateLimitPerMinute?: number; voice?: VoiceConfig } = {}): Hono<Env> {
  const app = new Hono<Env>();
  // ponytail: in-memory token bucket per key, one process only; move to Postgres or Redis when the API runs on several instances
  const buckets = new Map<string, { tokens: number; at: number }>();

  app.use("*", async (c, next) => {
    c.set("requestId", newId("req"));
    await next();
  });

  app.get("/health", (c) => ok(c, { status: "ok" }));
  mountUi(app);

  app.use("/v1/*", async (c, next) => {
    const key = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Fails closed: with no keys configured, nothing gets in.
    if (!key || !apiKeys().includes(key)) return fail(c, "unauthorized", "Missing or invalid API key");
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: rateLimitPerMinute, at: now };
    b.tokens = Math.min(rateLimitPerMinute, b.tokens + ((now - b.at) / 60_000) * rateLimitPerMinute);
    b.at = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      return fail(c, "rate_limited", `More than ${rateLimitPerMinute} requests a minute`);
    }
    b.tokens -= 1;
    buckets.set(key, b);
    c.set("apiKey", key);
    await next();
  });

  mountVoice(app, voice);

  app.post("/v1/research-runs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, "bad_request", "Body must be JSON");
    }
    const parsed = StartRunBody.safeParse(body);
    if (!parsed.success) return fail(c, "unprocessable", zodMessage(parsed.error));
    const runId = await startRun(parsed.data.profile, parsed.data.options);
    return ok(c, { runId, status: "queued" }, {}, 202);
  });

  app.get("/v1/research-runs/:runId", async (c) => {
    const run = await getRun(c.req.param("runId"));
    return run ? ok(c, run) : fail(c, "not_found", `Run ${c.req.param("runId")} does not exist`);
  });

  /** Loads a finished run's result, or answers not_found / conflict. */
  const doneRun = async (c: Ctx) => {
    const runId = c.req.param("runId") ?? "";
    const row = await getRunRow(runId);
    if (!row) return { error: fail(c, "not_found", `Run ${runId} does not exist`) } as const;
    if (row.status !== "done" || !row.result) return { error: fail(c, "conflict", `Run ${runId} is ${row.status}, not done`) } as const;
    return { runId, result: row.result } as const;
  };

  const paging = (c: Ctx) => Paging.safeParse({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });

  // Career paths are available as soon as the run publishes them, before the run is done.
  app.get("/v1/research-runs/:runId/career-paths", async (c) => {
    const runId = c.req.param("runId");
    const row = await getRunRow(runId);
    if (!row) return fail(c, "not_found", `Run ${runId} does not exist`);
    const paths = row.result?.careerPaths;
    if (!paths) return fail(c, "conflict", `Run ${runId} has no career paths yet (${row.status})`);
    return ok(c, paths);
  });

  app.get("/v1/research-runs/:runId/role-models", async (c) => {
    const r = await doneRun(c);
    return "error" in r ? r.error : ok(c, r.result.roleModels ?? []);
  });

  app.get("/v1/research-runs/:runId/trends", async (c) => {
    const r = await doneRun(c);
    return "error" in r ? r.error : ok(c, r.result.trends ?? []);
  });

  app.get("/v1/research-runs/:runId/market", async (c) => {
    const r = await doneRun(c);
    return "error" in r ? r.error : ok(c, r.result.market);
  });

  app.get("/v1/research-runs/:runId/seeker-research", async (c) => {
    const r = await doneRun(c);
    return "error" in r ? r.error : ok(c, r.result.seekerResearch);
  });

  app.get("/v1/research-runs/:runId/companies", async (c) => {
    const p = paging(c);
    if (!p.success) return fail(c, "bad_request", zodMessage(p.error));
    const r = await doneRun(c);
    if ("error" in r) return r.error;
    const { items, total } = await listRunCompanies(r.runId, p.data.page, p.data.pageSize);
    return ok(c, items, { ...p.data, total });
  });

  app.get("/v1/research-runs/:runId/vacancies", async (c) => {
    const p = paging(c);
    if (!p.success) return fail(c, "bad_request", zodMessage(p.error));
    const r = await doneRun(c);
    if ("error" in r) return r.error;
    const filters = { occupation: c.req.query("occupation") || undefined, companyId: c.req.query("companyId") || undefined };
    const { items, total } = await listRunVacancies(r.runId, filters, p.data.page, p.data.pageSize);
    return ok(c, items, { ...p.data, total });
  });

  app.delete("/v1/research-runs/:runId", async (c) => {
    const n = await deleteRun(c.req.param("runId"));
    return n ? ok(c, { deleted: true }) : fail(c, "not_found", `Run ${c.req.param("runId")} does not exist`);
  });

  app.get("/v1/seekers/:seekerId/research-runs", async (c) => ok(c, await listRunsForSeeker(c.req.param("seekerId"))));

  app.delete("/v1/seekers/:seekerId/research", async (c) => {
    const runs = await deleteResearchForSeeker(c.req.param("seekerId"));
    return ok(c, { deleted: true, runs });
  });

  app.get("/v1/companies/:companyId", async (c) => {
    const company = await getCompany(c.req.param("companyId"));
    return company ? ok(c, company) : fail(c, "not_found", `Company ${c.req.param("companyId")} does not exist`);
  });

  app.get("/v1/vacancies/:vacancyId", async (c) => {
    const vacancy = await getVacancy(c.req.param("vacancyId"), true);
    return vacancy ? ok(c, vacancy) : fail(c, "not_found", `Vacancy ${c.req.param("vacancyId")} does not exist`);
  });

  app.all("/v1/validations", part3Handler);
  app.all("/v1/validations/*", part3Handler);
  app.get("/v1/seekers/:seekerId/validations", part3Handler);
  app.delete("/v1/seekers/:seekerId/validations", part3Handler);

  app.all("/v1/roadmaps", part4Handler);
  app.all("/v1/roadmaps/*", part4Handler);
  app.get("/v1/seekers/:seekerId/roadmaps", part4Handler);
  app.delete("/v1/seekers/:seekerId/roadmaps", part4Handler);

  // Everything else under /v1/seekers is Part 1 (user input). Part 2's own seeker routes are registered above.
  app.all("/v1/seekers", part1Handler);
  app.all("/v1/seekers/*", part1Handler);

  app.notFound((c) => fail(c, "not_found", `No route ${c.req.method} ${c.req.path}`));

  app.onError((err, c) => {
    if (err instanceof RunError) return fail(c, err.code, err.message);
    log.error("request failed", { requestId: c.get("requestId"), path: c.req.path, error: errorMessage(err) });
    return fail(c, "internal", "Internal error"); // never leak the stack or the message of an unexpected error
  });

  return app;
}
