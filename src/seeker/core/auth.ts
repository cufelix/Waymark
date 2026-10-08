import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.ts";

export type Headers = Record<string, string | string[] | undefined>;

// API keys from env SEEKER_API_KEYS (comma-separated). No keys configured = every request is rejected.
export function parseApiKeys(raw: string | undefined = process.env.SEEKER_API_KEYS): string[] {
  return (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

export function header(headers: Headers, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

// API.md "Auth": `Authorization: Bearer <API key>` on every call.
// Keys are compared as SHA-256 digests with timingSafeEqual, so neither content nor length leaks,
// and every configured key is checked (no early exit).
export function authenticate(headers: Headers, keys: string[]): void {
  const value = header(headers, "authorization");
  const match = value ? /^Bearer\s+(\S+)\s*$/i.exec(value) : null;
  if (!match) throw new ApiError("unauthorized", "Missing or malformed Authorization header");
  const given = digest(match[1]);
  let valid = false;
  for (const key of keys) valid = timingSafeEqual(given, digest(key)) || valid;
  if (!valid) throw new ApiError("unauthorized", "Invalid API key");
}
