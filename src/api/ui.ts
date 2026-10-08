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
    if (!config.UI_LOCAL || !LOOPBACK.has(remote)) return c.json({ ok: false, data: null, error: { code: "unauthorized", message: "The local UI bridge is off" }, meta: {} }, 401);
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
