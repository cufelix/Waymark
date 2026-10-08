// Serves the UI (prototype/) from the API server and lets it call the API without holding a key.
// ponytail: /ui/api forwards with the server's own API key and is only on with UI_LOCAL=1 and only for
// requests from this machine; real users need login (Part 1 B1) before the UI is exposed beyond localhost.
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { apiKeys, config } from "../config";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// The Hono app type is generic in its env; this only needs routing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountUi(app: Hono<any>): void {
  app.all("/ui/api/*", async (c) => {
    const remote = getConnInfo(c).remote.address ?? "";
    const deny = (message: string) => c.json({ ok: false, data: null, error: { code: "unauthorized", message }, meta: {} }, 401);
    if (!config.UI_LOCAL || !LOOPBACK.has(remote)) return deny("The local UI bridge is off");
    // Other websites open in the same browser also reach localhost, so a loopback address is not enough:
    // Host must be localhost (stops DNS rebinding), the browser must not mark the request cross-site, and the
    // custom header can only be sent cross-origin after a CORS preflight, which this server never approves.
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(c.req.header("host") ?? "")) return deny("Bad host");
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return deny("Cross-site request");
    if (c.req.header("x-ethera-ui") !== "1") return deny("Missing UI header");
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
