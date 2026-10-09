// Serves the UI (prototype/) from the API server and lets it call the API without holding a key.
// The public bridge is suitable only for a fake-data demo: it uses the server's shared API key, not user auth.
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { apiKeys, config } from "../config";

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
  app.get("/", (c) => c.redirect("/index.html"));
  app.use("/*", serveStatic({ root: "./prototype" }));
}
