import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.API_KEYS = "persistence-test-key";
  process.env.DATABASE_URL = "postgres://research:research@localhost:5433/research";
});

import { createApp } from "../../src/api/app";
import { pool } from "../../src/db/pool";

const app = createApp({ rateLimitPerMinute: 1000 });
const headers = { authorization: "Bearer persistence-test-key", "content-type": "application/json" };
let seekerId = "";

afterAll(async () => {
  if (seekerId) await pool.query("DELETE FROM seeker_records WHERE seeker_id = $1", [seekerId]);
});

describe("production Part 1 mount", () => {
  it("stores a created seeker in PostgreSQL and reads it through a fresh request", async () => {
    const created = await app.request("/v1/seekers", {
      method: "POST",
      headers,
      body: JSON.stringify({
        consent: {
          dataProcessing: true,
          nameSearch: false,
          givenAt: "2026-10-09T00:00:00.000Z",
          policyVersion: "test-v1",
        },
      }),
    });
    expect(created.status).toBe(201);
    seekerId = (await created.json()).data.seekerId as string;

    const stored = await pool.query<{ seeker_id: string }>("SELECT seeker_id FROM seeker_records WHERE seeker_id = $1", [seekerId]);
    expect(stored.rows[0]?.seeker_id).toBe(seekerId);

    const profile = await app.request(`/v1/seekers/${seekerId}/profile`, { headers });
    expect(profile.status).toBe(200);
    expect((await profile.json()).data.seekerId).toBe(seekerId);
  });
});
