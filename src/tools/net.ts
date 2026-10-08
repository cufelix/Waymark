// SSRF guard and a safe GET for URLs that come from seekers or the agent.
// Every hop is checked: only public addresses, only ports 80/443, redirects followed by hand,
// and the connection is pinned to the address we vetted (no DNS rebinding between check and connect).
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";

export type Vetted = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export type SafeResponse = { status: number; headers: Record<string, string>; body: Buffer; finalUrl: string };
export type Requester = (url: URL, vetted: Vetted, headers: Record<string, string>, maxBytes: number, timeoutMs: number) => Promise<Omit<SafeResponse, "finalUrl">>;

export class BlockedUrlError extends Error {}

const defaultResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

function isPublicV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;            // this-network, private, loopback, multicast, reserved, broadcast
  if (a === 100 && b >= 64 && b <= 127) return false;                         // carrier-grade NAT 100.64/10
  if (a === 169 && b === 254) return false;                                   // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;                          // private 172.16/12
  if (a === 192 && b === 168) return false;                                   // private 192.168/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;             // IETF protocol, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false;                      // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return false;                       // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;                        // TEST-NET-3
  return true;
}

/** Expands an IPv6 address into 8 numeric hextets. Input must already be valid IPv6. */
function hextets(ip: string): number[] {
  let s = ip.split("%")[0] ?? ip;
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.split(".").map(Number);
    s = s.slice(0, -v4.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x, 16));
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPublicV4(ip);
  if (!net.isIPv6(ip.split("%")[0] ?? "")) return false;
  const h = hextets(ip);
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  const embeddedV4 = `${h6 >> 8}.${h6 & 255}.${h7 >> 8}.${h7 & 255}`;
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0) {
    if (h5 === 0xffff) return isPublicV4(embeddedV4);                         // IPv4-mapped ::ffff:a.b.c.d
    return false;                                                             // ::, ::1, IPv4-compatible ::/96
  }
  if (h0 === 0x64 && h1 === 0xff9b) return isPublicV4(embeddedV4);            // NAT64 64:ff9b::/96
  if ((h0 & 0xfe00) === 0xfc00) return false;                                 // unique local fc00::/7
  if ((h0 & 0xffc0) === 0xfe80) return false;                                 // link-local fe80::/10
  if ((h0 & 0xff00) === 0xff00) return false;                                 // multicast ff00::/8
  if (h0 === 0x2001 && h1 === 0x0db8) return false;                           // documentation
  return true;
}

/** Throws BlockedUrlError unless the URL is http(s) on 80/443 and every address it resolves to is public. */
export async function assertPublicUrl(u: URL, resolve: Resolver = defaultResolver): Promise<Vetted> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError(`Blocked: only http(s) URLs are allowed (${u.protocol})`);
  if (u.port && u.port !== "80" && u.port !== "443") throw new BlockedUrlError(`Blocked: port ${u.port} is not allowed`);
  if (u.username || u.password) throw new BlockedUrlError("Blocked: URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new BlockedUrlError(`Blocked: ${host} is an internal host name`);
  }
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError(`Blocked: ${host} is not a public address`);
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  const addrs = await resolve(host);
  if (addrs.length === 0) throw new BlockedUrlError(`Blocked: ${host} does not resolve`);
  const bad = addrs.find((a) => !isPublicAddress(a.address));
  if (bad) throw new BlockedUrlError(`Blocked: ${host} resolves to non-public address ${bad.address}`);
  const first = addrs[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/** Reads a stream into a Buffer, failing as soon as it grows past maxBytes. */
export async function collectCapped(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.byteLength;
    if (size > maxBytes) {
      stream.destroy();
      throw new Error(`Response too large (over ${maxBytes} bytes)`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** One GET over node:http(s), with the connection pinned to the vetted address. */
const defaultRequester: Requester = (url, vetted, headers, maxBytes, timeoutMs) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers,
        timeout: timeoutMs,
        // Pin: whatever Node asks DNS for, it gets the address we already checked.
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: vetted.address, family: vetted.family }]) : cb(null, vetted.address, vetted.family)) as never,
      },
      (res) => {
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          reject(new Error(`Response too large (${declared} bytes, limit ${maxBytes})`));
          return;
        }
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(", ") : v;
        collectCapped(res, maxBytes).then((body) => resolve({ status: res.statusCode ?? 0, headers: flat, body }), reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end();
  });

export type SafeGetOptions = {
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolve?: Resolver;
  request?: Requester;
};

/** GET that vets every hop (including each redirect target) before connecting. */
export async function safeGet(url: string | URL, opts: SafeGetOptions = {}): Promise<SafeResponse> {
  const { headers = {}, maxBytes = 3 * 1024 * 1024, timeoutMs = 15_000, maxRedirects = 5, resolve, request = defaultRequester } = opts;
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    const vetted = await assertPublicUrl(current, resolve);
    const res = await request(current, vetted, headers, maxBytes, timeoutMs);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= maxRedirects) throw new Error(`Too many redirects (more than ${maxRedirects})`);
      current = new URL(res.headers.location, current);
      continue;
    }
    return { ...res, finalUrl: current.href };
  }
}
