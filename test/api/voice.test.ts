import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.API_KEYS = "voice-test-key";
});

import { createApp } from "../../src/api/app";
import { resetVoiceUsageForTests, type VoiceConfig } from "../../src/api/voice";

const KEY = { authorization: "Bearer voice-test-key" };
const JSON_HEADERS = { ...KEY, "content-type": "application/json" };
const configured: VoiceConfig = {
  apiKey: "fake-elevenlabs-key",
  voiceId: "fake-voice-id",
  ttsModel: "eleven_flash_v2_5",
  charsPerDay: 20_000,
};

beforeEach(() => {
  resetVoiceUsageForTests();
  vi.restoreAllMocks();
});

describe("ElevenLabs voice API", () => {
  it("returns MPEG audio and sends only the configured ElevenLabs request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    }));
    const app = createApp({ voice: configured, rateLimitPerMinute: 100 });
    const response = await app.request("/v1/voice/speech", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text: "Hello from Waymark" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/text-to-speech/fake-voice-id?output_format=mp3_44100_128");
    expect(init?.headers).toEqual({ "content-type": "application/json", "xi-api-key": "fake-elevenlabs-key" });
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Hello from Waymark", model_id: "eleven_flash_v2_5" });
  });

  it("transcribes multipart audio and returns the normal envelope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ text: "A spoken answer" }));
    const app = createApp({ voice: configured, rateLimitPerMinute: 100 });
    const form = new FormData();
    form.append("file", new File([new Uint8Array([4, 5])], "answer.webm", { type: "audio/webm" }));
    const response = await app.request("/v1/voice/transcribe", { method: "POST", headers: KEY, body: form });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { text: "A spoken answer" }, error: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init?.headers).toEqual({ "xi-api-key": "fake-elevenlabs-key" });
    const sent = init?.body as FormData;
    expect(sent.get("model_id")).toBe("scribe_v1");
    expect(sent.get("file")).toBeInstanceOf(File);
  });

  it("fails closed when voice is not configured", async () => {
    const app = createApp({ voice: { ...configured, apiKey: undefined }, rateLimitPerMinute: 100 });
    const speech = await app.request("/v1/voice/speech", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: "Hello" }) });
    const form = new FormData();
    form.append("file", new File(["audio"], "answer.webm", { type: "audio/webm" }));
    const transcribe = await app.request("/v1/voice/transcribe", { method: "POST", headers: KEY, body: form });

    expect(speech.status).toBe(422);
    expect(await speech.json()).toMatchObject({ error: { code: "unprocessable", message: "Voice is not configured" } });
    expect(transcribe.status).toBe(422);
    expect(await transcribe.json()).toMatchObject({ error: { code: "unprocessable", message: "Voice is not configured" } });
  });

  it("rejects speech over 600 characters before calling the provider", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const app = createApp({ voice: configured, rateLimitPerMinute: 100 });
    const response = await app.request("/v1/voice/speech", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text: "x".repeat(601) }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "unprocessable", message: "text: must be at most 600 characters" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the in-process daily character cap", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
    const app = createApp({ voice: { ...configured, charsPerDay: 5 }, rateLimitPerMinute: 100 });
    const first = await app.request("/v1/voice/speech", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: "12345" }) });
    const second = await app.request("/v1/voice/speech", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text: "6" }) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("maps provider failures without exposing the response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("provider secret details", { status: 500 }));
    const app = createApp({ voice: configured, rateLimitPerMinute: 100 });
    const response = await app.request("/v1/voice/speech", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text: "Hello" }),
    });
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("provider secret details");
  });
});
