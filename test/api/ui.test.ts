import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountUi } from "../../src/api/ui";

const PUBLIC_ORIGIN = "https://waymark.example.com";
const goodHeaders = (overrides: Record<string, string> = {}): Record<string, string> => ({
  host: "waymark.example.com",
  origin: PUBLIC_ORIGIN,
  "sec-fetch-site": "same-origin",
  "x-ethera-ui": "1",
  "cf-connecting-ip": "192.0.2.10",
  ...overrides,
});

function publicApp(rateLimitPerMinute = 120): Hono {
  const app = new Hono();
  mountUi(app, {
    publicOrigin: PUBLIC_ORIGIN,
    trustCloudflare: true,
    publicRateLimitPerMinute: rateLimitPerMinute,
  });
  app.post("/v1/seekers", (c) => c.json({ ok: true, data: { seekerId: MINE } }, 201));
  app.get("/v1/seekers/:id/profile", (c) => c.json({ ok: true, data: { seekerId: c.req.param("id"), stored: true } }));
  app.post("/v1/research-runs", async (c) => c.json({ ok: true, data: { received: await c.req.json() } }, 202));
  return app;
}

const MINE = "skr_01M4F8TT410FBJT0DQMV6MCB9N";
const THEIRS = "skr_01M4F8TT410FBJT0DQMV6MCB9X";

/** Creates a seeker through the public bridge and returns its session cookie. */
async function session(app: Hono): Promise<string> {
  const res = await app.request(`${PUBLIC_ORIGIN}/ui/api/v1/seekers`, { method: "POST", headers: { ...goodHeaders(), "content-type": "application/json" }, body: "{}" });
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

const bridge = (app: Hono, headers: Record<string, string>, seeker = MINE) =>
  app.request(`${PUBLIC_ORIGIN}/ui/api/v1/seekers/${seeker}/profile`, { headers });

describe("public UI bridge", () => {
  it("serves the static UI in public mode", async () => {
    const response = await publicApp().request(`${PUBLIC_ORIGIN}/index.html`, {
      headers: { host: "waymark.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("accepts the configured host with a seeker session, for that seeker's own data", async () => {
    const app = publicApp();
    const cookie = await session(app);
    expect(cookie).toMatch(/^wm_seeker=skr_/);

    const response = await bridge(app, goodHeaders({ cookie }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { seekerId: MINE, stored: true } });
  });

  it("rejects public requests without a session (the server key is never lent to strangers)", async () => {
    expect((await bridge(publicApp(), goodHeaders())).status).toBe(401);
  });

  it("rejects another seeker's data and a forged cookie", async () => {
    const app = publicApp();
    const cookie = await session(app);
    expect((await bridge(app, goodHeaders({ cookie }), THEIRS)).status).toBe(404);
    expect((await bridge(app, goodHeaders({ cookie: `wm_seeker=${THEIRS}.forged` }), THEIRS)).status).toBe(401);
  });

  it("rejects the wrong host", async () => {
    const response = await bridge(publicApp(), goodHeaders({ host: "attacker.example.com" }));

    expect(response.status).toBe(401);
  });

  it("rejects cross-site requests", async () => {
    const response = await bridge(publicApp(), goodHeaders({ "sec-fetch-site": "cross-site" }));

    expect(response.status).toBe(401);
  });

  it("rejects requests without Sec-Fetch-Site", async () => {
    const headers = goodHeaders();
    delete headers["sec-fetch-site"];

    const response = await bridge(publicApp(), headers);

    expect(response.status).toBe(401);
  });

  it("rejects requests without the UI header", async () => {
    const headers = goodHeaders();
    delete headers["x-ethera-ui"];

    const response = await bridge(publicApp(), headers);

    expect(response.status).toBe(401);
  });

  it("rejects a mismatched Origin", async () => {
    const response = await bridge(publicApp(), goodHeaders({ origin: "https://attacker.example.com" }));

    expect(response.status).toBe(401);
  });

  it("rate limits each Cloudflare client IP independently", async () => {
    const app = publicApp(3);
    const cookie = await session(app);   // counts as the first request

    expect((await bridge(app, goodHeaders({ cookie }))).status).toBe(200);
    expect((await bridge(app, goodHeaders({ cookie }))).status).toBe(200);
    const limited = await bridge(app, goodHeaders({ cookie }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });

    expect((await bridge(app, goodHeaders({ cookie, "cf-connecting-ip": "192.0.2.11" }))).status).toBe(200);
  });

  it("starts research on the stored profile, ignoring a forged one, and limits runs per day", async () => {
    const app = publicApp(100);
    const cookie = await session(app);
    const post = () => app.request(`${PUBLIC_ORIGIN}/ui/api/v1/research-runs`, {
      method: "POST", headers: { ...goodHeaders({ cookie }), "content-type": "application/json" },
      body: JSON.stringify({ profile: { seekerId: MINE, status: "complete", forged: true } }),
    });
    const first = await post();
    expect(first.status).toBe(202);
    expect((await first.json()).data.received.profile).toEqual({ seekerId: MINE, stored: true });
    expect((await post()).status).toBe(202);
    expect((await post()).status).toBe(429);
  });

  it("limits new profiles per address per day", async () => {
    const app = publicApp(100);
    for (let i = 0; i < 5; i++) expect(await session(app)).toMatch(/^wm_seeker=/);
    const sixth = await app.request(`${PUBLIC_ORIGIN}/ui/api/v1/seekers`, { method: "POST", headers: { ...goodHeaders(), "content-type": "application/json" }, body: "{}" });
    expect(sixth.status).toBe(429);
  });
});
