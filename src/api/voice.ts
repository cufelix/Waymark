import type { Hono } from "hono";
import { z } from "zod";
import { config } from "../config";

type VoiceEnv = { Variables: { requestId: string; apiKey: string } };

export type VoiceConfig = {
  apiKey?: string;
  voiceId: string;
  ttsModel: string;
  charsPerDay: number;
};

export const voiceConfig = (): VoiceConfig => ({
  apiKey: config.ELEVENLABS_API_KEY,
  voiceId: config.ELEVENLABS_VOICE_ID,
  ttsModel: config.ELEVENLABS_TTS_MODEL,
  charsPerDay: config.CAP_ELEVENLABS_CHARS_PER_DAY,
});

const SpeechBody = z.object({ text: z.string().min(1).max(600) }).strict();
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
let daily = { day: "", chars: 0 };

const envelope = (requestId: string, code: string, message: string) => ({
  ok: false,
  data: null,
  error: { code, message },
  meta: { requestId },
});

function usageToday(): typeof daily {
  const day = new Date().toISOString().slice(0, 10);
  if (daily.day !== day) daily = { day, chars: 0 };
  return daily;
}

/** Used only to isolate the in-process cap between tests. */
export function resetVoiceUsageForTests(): void {
  daily = { day: "", chars: 0 };
}

export function mountVoice(app: Hono<VoiceEnv>, settings: VoiceConfig = voiceConfig()): void {
  app.post("/v1/voice/speech", async (c) => {
    const requestId = c.get("requestId");
    if (!settings.apiKey) return c.json(envelope(requestId, "unprocessable", "Voice is not configured"), 422);

    let value: unknown;
    try {
      value = await c.req.json();
    } catch {
      return c.json(envelope(requestId, "bad_request", "Body must be JSON"), 400);
    }
    const parsed = SpeechBody.safeParse(value);
    if (!parsed.success) {
      const tooLong = typeof (value as { text?: unknown })?.text === "string" && (value as { text: string }).text.length > 600;
      return c.json(envelope(requestId, "unprocessable", tooLong ? "text: must be at most 600 characters" : "text: must be a non-empty string"), 422);
    }

    const usage = usageToday();
    if (usage.chars + parsed.data.text.length > settings.charsPerDay) {
      return c.json(envelope(requestId, "rate_limited", "Daily voice character limit reached"), 429);
    }
    usage.chars += parsed.data.text.length;
    let upstream: Response;
    try {
      upstream = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "xi-api-key": settings.apiKey },
          body: JSON.stringify({ text: parsed.data.text, model_id: settings.ttsModel }),
        },
      );
    } catch {
      usage.chars -= parsed.data.text.length;
      return c.json(envelope(requestId, "upstream_failed", "Voice provider failed"), 502);
    }
    if (!upstream.ok) {
      usage.chars -= parsed.data.text.length;
      return c.json(envelope(requestId, "upstream_failed", "Voice provider failed"), 502);
    }
    return new Response(upstream.body, { status: 200, headers: { "content-type": "audio/mpeg" } });
  });

  app.post("/v1/voice/transcribe", async (c) => {
    const requestId = c.get("requestId");
    if (!settings.apiKey) return c.json(envelope(requestId, "unprocessable", "Voice is not configured"), 422);

    let body: Record<string, string | File>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json(envelope(requestId, "bad_request", "Body must be multipart form data"), 400);
    }
    const file = body.file;
    if (!(file instanceof File)) return c.json(envelope(requestId, "unprocessable", "file: audio file is required"), 422);
    if (file.size > MAX_AUDIO_BYTES) return c.json(envelope(requestId, "unprocessable", "file: must be at most 10 MB"), 422);
    if (file.type && !file.type.startsWith("audio/")) return c.json(envelope(requestId, "unprocessable", "file: must be audio"), 422);

    const form = new FormData();
    form.append("file", file, file.name || "recording.webm");
    form.append("model_id", "scribe_v1");
    let upstream: Response;
    try {
      upstream = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": settings.apiKey },
        body: form,
      });
    } catch {
      return c.json(envelope(requestId, "upstream_failed", "Voice provider failed"), 502);
    }
    if (!upstream.ok) return c.json(envelope(requestId, "upstream_failed", "Voice provider failed"), 502);
    const result = await upstream.json().catch(() => null) as { text?: unknown } | null;
    if (!result || typeof result.text !== "string") {
      return c.json(envelope(requestId, "upstream_failed", "Voice provider returned an invalid response"), 502);
    }
    return c.json({ ok: true, data: { text: result.text }, error: null, meta: { requestId } });
  });
}
