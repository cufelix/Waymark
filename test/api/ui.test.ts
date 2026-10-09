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
  app.get("/v1/ping", (c) => c.json({ ok: true }));
  return app;
}

const bridge = (app: Hono, headers: Record<string, string>) =>
  app.request(`${PUBLIC_ORIGIN}/ui/api/v1/ping`, { headers });

describe("public UI bridge", () => {
  it("serves the static UI in public mode", async () => {
    const response = await publicApp().request(`${PUBLIC_ORIGIN}/index.html`, {
      headers: { host: "waymark.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("accepts the configured host and same-origin browser headers", async () => {
    const response = await bridge(publicApp(), goodHeaders());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
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
    const app = publicApp(2);

    expect((await bridge(app, goodHeaders())).status).toBe(200);
    expect((await bridge(app, goodHeaders())).status).toBe(200);
    const limited = await bridge(app, goodHeaders());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });

    expect((await bridge(app, goodHeaders({ "cf-connecting-ip": "192.0.2.11" }))).status).toBe(200);
  });
});
