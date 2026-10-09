// Serves the UI (prototype/) from the API server and lets it call the API without holding a key.
// Local mode (this machine only) forwards everything. Public mode is scoped to one seeker per browser: creating a
// seeker sets a signed HttpOnly session cookie, and every later request may only touch that seeker's own data.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { apiKeys, config } from "../config";
import { query } from "../db/pool";

const COOKIE = "wm_seeker";
const SEEKER = /^skr_[0-9A-Za-z]{26}$/;

const sign = (seekerId: string) => createHmac("sha256", config.PROOF_SECRET).update(`ui-session:${seekerId}`).digest("base64url");

/** The seeker id in a valid session cookie, or null. */
export function sessionSeeker(cookieHeader: string | undefined): string | null {
  const raw = (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [id, mac] = (raw ?? "").split(".");
  if (!id || !mac || !SEEKER.test(id)) return null;
  const want = Buffer.from(sign(id));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** Every "seekerId" value anywhere in a JSON body. */
function seekerIdsIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => seekerIdsIn(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "seekerId" && typeof x === "string") out.push(x);
      else seekerIdsIn(x, out);
    }
  }
  return out;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

type UiOptions = {
  local?: boolean;
  publicOrigin?: string;
  trustCloudflare?: boolean;
  publicRateLimitPerMinute?: number;
};

// The Hono app type is generic in its env; this only needs routing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountUi(app: Hono<any>, {
  local = config.UI_LOCAL,
  publicOrigin = config.UI_PUBLIC_ORIGIN,
  trustCloudflare = config.TRUST_CLOUDFLARE,
  publicRateLimitPerMinute = 120,
}: UiOptions = {}): void {
  const publicUrl = publicOrigin ? new URL(publicOrigin) : undefined;
  const publicBuckets = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = Date.now() + 60_000;

  const takePublicRequest = (clientIp: string): boolean => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [ip, bucket] of publicBuckets) if (bucket.resetAt <= now) publicBuckets.delete(ip);
      nextSweep = now + 60_000;
    }
    if (publicBuckets.size > 50_000 && !publicBuckets.has(clientIp)) return false; // bounded memory under spoofing
    const current = publicBuckets.get(clientIp);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
    bucket.count += 1;
    publicBuckets.set(clientIp, bucket);
    return bucket.count <= publicRateLimitPerMinute;
  };

  app.all("/ui/api/*", async (c) => {
    const deny = (message: string) => c.json({ ok: false, data: null, error: { code: "unauthorized", message }, meta: {} }, 401);
    const host = c.req.header("host") ?? "";
    const site = c.req.header("sec-fetch-site");
    const isPublicHost = publicUrl?.host.toLowerCase() === host.trim().toLowerCase();

    if (isPublicHost) {
      if (site !== "same-origin" && site !== "none") return deny("Cross-site request");
      if (c.req.header("x-ethera-ui") !== "1") return deny("Missing UI header");
      const origin = c.req.header("origin");
      if (origin && origin !== publicUrl.origin) return deny("Bad origin");
      const clientIp = trustCloudflare
        ? (c.req.header("cf-connecting-ip")?.trim() || getConnInfo(c).remote.address || "")
        : (getConnInfo(c).remote.address ?? "");
      if (!takePublicRequest(clientIp)) {
        return c.json({ ok: false, data: null, error: { code: "rate_limited", message: `More than ${publicRateLimitPerMinute} requests a minute` }, meta: {} }, 429);
      }
      return publicRequest(c);
    } else {
      if (publicUrl && !local) return deny("Bad host");
      const remote = getConnInfo(c).remote.address ?? "";
      if (!local || !LOOPBACK.has(remote)) return deny("The local UI bridge is off");
      // Other websites open in the same browser also reach localhost, so a loopback address is not enough:
      // Host must be localhost (stops DNS rebinding), the browser must not mark the request cross-site, and the
      // custom header can only be sent cross-origin after a CORS preflight, which this server never approves.
      if (!LOCAL_HOST.test(host)) return deny("Bad host");
      if (site && site !== "same-origin" && site !== "none") return deny("Cross-site request");
      if (c.req.header("x-ethera-ui") !== "1") return deny("Missing UI header");
    }

    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(/^\/ui\/api/, "");
    const headers = new Headers(c.req.raw.headers);
    headers.set("authorization", `Bearer ${apiKeys()[0] ?? ""}`);
    const init: RequestInit & { duplex?: "half" } = { method: c.req.method, headers };
    if (!["GET", "HEAD"].includes(c.req.method)) {
      init.body = c.req.raw.body;
      init.duplex = "half";
    }
    return app.fetch(new Request(url, init), c.env);
  });

  // Spend quotas for anonymous public use (per day). ponytail: in memory, one process; move to Postgres for several instances.
  const DAY = 86_400_000;
  const quota = new Map<string, { n: number; resetAt: number }>();
  const take = (key: string, limit: number): boolean => {
    const now = Date.now();
    if (quota.size > 100_000) for (const [k, v] of quota) if (v.resetAt <= now) quota.delete(k);
    const q = quota.get(key);
    const cur = !q || q.resetAt <= now ? { n: 0, resetAt: now + DAY } : q;
    cur.n += 1;
    quota.set(key, cur);
    return cur.n <= limit;
  };
  const SEEKERS_PER_IP_PER_DAY = 5;
  const RUNS_PER_SEEKER_PER_DAY = 2;
  const MODEL_CALLS_PER_SEEKER_PER_DAY = 150;
  const GENERATIONS_PER_SEEKER_PER_DAY = 5;   // validations and roadmaps each
  // Routes that call a paid model or provider on the seeker's behalf.
  const MODEL_ROUTE = /^\/v1\/seekers\/skr_[0-9A-Za-z]+\/(interview|intake|documents|voice)/;

  /** Forwards one API request with the server key, without any client cookie. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forward = (c: any, path: string, method: string, body?: string, contentType?: string) => {
    const headers = new Headers({ authorization: `Bearer ${apiKeys()[0] ?? ""}` });
    if (contentType) headers.set("content-type", contentType);
    return app.fetch(new Request(new URL(path, "http://internal"), { method, headers, ...(body !== undefined ? { body } : {}) }), c.env);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientIpOf = (c: any): string =>
    trustCloudflare ? (c.req.header("cf-connecting-ip")?.trim() || getConnInfo(c).remote.address || "") : (getConnInfo(c).remote.address ?? "");

  /** Does this seeker own the validation or roadmap with this id? Checked before the request runs. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownsResource = async (c: any, kind: "validations" | "roadmaps", id: string, own: string): Promise<boolean> => {
    const res = await forward(c, `/v1/${kind}/${id}`, "GET");
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const ids = seekerIdsIn(json?.data);
    return ids.length > 0 && ids.every((x) => x === own);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authorize = async (c: any, path: string, method: string, body: string | undefined, own: string): Promise<boolean> => {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/v1\/seekers\/(skr_[0-9A-Za-z]+)(\/|$)/))) return m[1] === own;
    if ((m = path.match(/^\/v1\/research-runs\/(run_[0-9a-z]+)(\/|$)/))) {
      const [row] = await query<{ seeker_id: string }>("SELECT seeker_id FROM research_runs WHERE id = $1", [m[1]]);
      return row?.seeker_id === own;
    }
    if ((m = path.match(/^\/v1\/(validations|roadmaps)\/((?:val|rmp)_[0-9A-Za-z]+)(\/|$)/))) return ownsResource(c, m[1] as "validations" | "roadmaps", m[2]!, own);
    if (method === "POST" && /^\/v1\/(research-runs|validations|roadmaps)$/.test(path)) {
      let parsed: unknown;
      try { parsed = JSON.parse(body ?? ""); } catch { return false; }
      const ids = seekerIdsIn(parsed);
      return ids.length > 0 && ids.every((x) => x === own);
    }
    // Public market data, the same for every seeker.
    if (method === "GET" && /^\/v1\/(companies|vacancies)\/[0-9A-Za-z_]+$/.test(path)) return true;
    return false;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publicRequest = async (c: any): Promise<Response> => {
    const path = new URL(c.req.url).pathname.replace(/^\/ui\/api/, "");
    const method: string = c.req.method;
    const contentType: string | undefined = c.req.header("content-type");
    const multipart = contentType?.startsWith("multipart/form-data");
    const deny = (status: 401 | 403 | 404, message: string) => c.json({ ok: false, data: null, error: { code: status === 404 ? "not_found" : "unauthorized", message }, meta: {} }, status);

    const limited = (message: string) => c.json({ ok: false, data: null, error: { code: "rate_limited", message }, meta: {} }, 429);
    // Creating a seeker starts the session: the new id goes into a signed, HttpOnly, same-site cookie.
    if (method === "POST" && path === "/v1/seekers") {
      if (!take(`ip:${clientIpOf(c)}`, SEEKERS_PER_IP_PER_DAY)) return limited(`At most ${SEEKERS_PER_IP_PER_DAY} new profiles a day from one address`);
      const res = await forward(c, path, method, await c.req.text(), contentType);
      const json = (await res.clone().json().catch(() => null)) as { data?: { seekerId?: string } } | null;
      const id = json?.data?.seekerId;
      if (res.status !== 201 || !id || !SEEKER.test(id)) return res;
      const out = new Response(res.body, res);
      out.headers.append("set-cookie", `${COOKIE}=${id}.${sign(id)}; Path=/ui/api; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
      return out;
    }
    const own = sessionSeeker(c.req.header("cookie"));
    if (!own) return deny(401, "No seeker session");
    const body = multipart || method === "GET" || method === "HEAD" ? undefined : await c.req.text();
    if (!(await authorize(c, path, method, body, own))) return deny(404, "Not found");
    if (method !== "GET" && MODEL_ROUTE.test(path) && !take(`model:${own}`, MODEL_CALLS_PER_SEEKER_PER_DAY)) return limited("Daily limit for this profile reached");
    if (method === "POST" && /^\/v1\/(validations|roadmaps)$/.test(path) && !take(`gen:${own}:${path}`, GENERATIONS_PER_SEEKER_PER_DAY)) {
      return limited(`At most ${GENERATIONS_PER_SEEKER_PER_DAY} a day per profile`);
    }
    if (method === "POST" && path === "/v1/research-runs") {
      if (!take(`run:${own}`, RUNS_PER_SEEKER_PER_DAY)) return limited(`At most ${RUNS_PER_SEEKER_PER_DAY} research runs a day per profile`);
      // Research runs on the profile stored for this seeker, never on one the browser sends.
      const stored = await forward(c, `/v1/seekers/${own}/profile`, "GET");
      const storedJson = (await stored.json().catch(() => null)) as { data?: unknown } | null;
      if (!stored.ok || !storedJson?.data) return deny(404, "Not found");
      // Options (sources, sizes) come from the server's defaults in public use, never from the browser.
      return forward(c, path, method, JSON.stringify({ profile: storedJson.data }), "application/json");
    }
    if (multipart) {
      // CV uploads go to the seeker's own documents route, already checked above.
      const headers = new Headers({ authorization: `Bearer ${apiKeys()[0] ?? ""}`, "content-type": contentType! });
      return app.fetch(new Request(new URL(path, "http://internal"), { method, headers, body: c.req.raw.body, duplex: "half" } as RequestInit), c.env);
    }
    return forward(c, path + new URL(c.req.url).search, method, body, contentType);
  };
  app.get("/", (c) => c.redirect("/index.html"));
  app.use("/*", serveStatic({ root: "./prototype" }));
}
