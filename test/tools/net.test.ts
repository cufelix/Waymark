import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPublicAddress, safeGet, type Requester } from "../../src/tools/net";

const resolvesTo = (address: string) => async () => [{ address, family: address.includes(":") ? 6 : 4 }];

describe("SSRF guard", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.5.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])(
    "rejects non-public address %s",
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  );

  it.each(["8.8.8.8", "140.82.112.3", "2606:4700:4700::1111"])("accepts public address %s", (ip) => expect(isPublicAddress(ip)).toBe(true));

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8787/v1/research-runs",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://example.com:5433/",
    "https://user:pass@example.com/",
  ])("blocks %s", async (u) => {
    await expect(assertPublicUrl(new URL(u), resolvesTo("93.184.215.14"))).rejects.toThrow(/Blocked/);
  });

  it("blocks a public name that resolves to a private address (DNS rebinding)", async () => {
    await expect(assertPublicUrl(new URL("https://evil.example/"), resolvesTo("10.1.2.3"))).rejects.toThrow(/non-public/);
  });

  it("allows a public host", async () => {
    await expect(assertPublicUrl(new URL("https://example.com/x"), resolvesTo("93.184.215.14"))).resolves.toMatchObject({ address: "93.184.215.14" });
  });

  it("re-checks redirects and blocks a hop to an internal address", async () => {
    const request: Requester = async (url) =>
      url.hostname === "example.com"
        ? { status: 302, headers: { location: "http://10.0.0.1/admin" }, body: Buffer.alloc(0) }
        : { status: 200, headers: {} as Record<string, string>, body: Buffer.from("secret") };
    await expect(safeGet("https://example.com/", { request, resolve: resolvesTo("93.184.215.14") })).rejects.toThrow(/Blocked/);
  });
});

import { runCostUsd } from "../../src/tools/apify";
describe("Apify run cost", () => {
  it("adds pay-per-event charges to platform usage", () => {
    expect(runCostUsd({
      usageTotalUsd: 0.003,
      chargedEventCounts: { "apify-default-dataset-item": 20, "apify-actor-start": 1 },
      pricingInfo: { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { "apify-default-dataset-item": { eventPriceUsd: 0.001 }, "apify-actor-start": { eventPriceUsd: 0.005 } } } },
    })).toBeCloseTo(0.028);
  });
  it("is unknown (null) when Apify reports no usage yet, so the estimate is kept", () => {
    expect(runCostUsd({})).toBeNull();
  });
});

import { assertGithubPath } from "../../src/tools/github";
describe("github_api path guard", () => {
  it.each(["/users/%2e%2e/user/repos", "/users/..%2fuser", "/users/x/../../user", "/repos/a//b", "/users/a\\..\\user", "/user/repos", "/users/a b"])("refuses %s", (p) => {
    expect(() => assertGithubPath(p)).toThrow();
  });
  it("allows plain public paths", () => {
    expect(assertGithubPath("/users/torvalds/repos?per_page=100&sort=pushed").pathname).toBe("/users/torvalds/repos");
    expect(assertGithubPath("/search/users?q=google+type:org&per_page=5").pathname).toBe("/search/users");
  });
});
