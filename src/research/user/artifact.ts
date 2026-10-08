// Turns whatever the tools returned into one normalised Artifact, deterministically (no model).
import type { Source } from "../../contracts";
import { newId } from "../../ids";
import { saveSnapshot } from "../../storage/snapshots";
import { clip, type ToolResult } from "../../tools/types";

export type Extractor = "official-api" | "apify" | "firecrawl" | "fetch" | "exa" | "none";
export type ArtifactStatus = "extracted" | "partial" | "unsupported" | "failed";

export type ArtifactItem = { title: string; url?: string; date?: string; text?: string; metrics?: Record<string, number> };

export type Artifact = {
  inputId: string;
  url: string;
  platform: string;
  extractor: Extractor;
  status: ArtifactStatus;
  reason?: string;
  owner?: { displayName?: string; handle?: string; links: string[] };
  text: string;
  fields: Record<string, unknown>;
  items: ArtifactItem[];
  source?: Source;
};

export type OkResult = Extract<ToolResult, { ok: true }>;
export type Step = { tool: string; result: OkResult };

export const extractorOf = (tool: string): Extractor =>
  tool === "fetch_url" ? "fetch"
  : tool.startsWith("firecrawl") ? "firecrawl"
  : tool.startsWith("apify") ? "apify"
  : tool.startsWith("exa") ? "exa"
  : tool === "github_api" ? "official-api"
  : "none";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const pick = (o: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return undefined;
};

const TITLE = ["title", "name", "full_name", "caption", "headline"];
const URL_KEYS = ["url", "link", "html_url", "permalink_url", "webVideoUrl", "webUrl", "postUrl", "shareUrl"];
const DATE = ["date", "publishedDate", "publishedAt", "createdAt", "created_at", "createTimeISO", "uploadDate", "pushed_at", "timestamp", "display_date"];
const TEXT = ["description", "text", "caption", "body", "desc", "summary", "bio"];
const METRIC = /count|plays|views|likes|stars|forks|followers|playback|digg|share|comment|reposts|downloads/i;
const NAME = ["displayName", "display_name", "full_name", "fullName", "name", "nickname", "authorName"];
const HANDLE = ["login", "username", "uniqueId", "permalink", "handle", "screen_name", "userName", "ownerUsername"];
const LINK = ["website", "blog", "website_url", "externalUrl", "bioLink", "homepage"];
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

function toItem(o: Record<string, unknown>): ArtifactItem | null {
  const text = pick(o, TEXT);
  const title = pick(o, TITLE) ?? text?.slice(0, 120);
  if (!title) return null;
  const metrics: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "number" && METRIC.test(k)) metrics[k] = v;
  return { title, url: pick(o, URL_KEYS), date: pick(o, DATE), text: text?.slice(0, 1000), ...(Object.keys(metrics).length ? { metrics } : {}) };
}

/** Records from raw outputs: arrays themselves, or array fields like `items`/`results`/`data`. */
function records(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isObj);
  if (isObj(raw)) for (const k of ["items", "results", "data", "tracks", "videos", "posts", "repos"]) if (Array.isArray(raw[k])) return (raw[k] as unknown[]).filter(isObj);
  return [];
}

/** Candidate objects that may describe the owner: the raw object itself, and nested author/user/owner objects. */
function ownerCandidates(raw: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (o: unknown, depth: number) => {
    if (!isObj(o) || depth > 2) return;
    out.push(o);
    for (const k of ["author", "user", "owner", "authorMeta", "channel", "profile", "artist", "metadata"]) visit(o[k], depth + 1);
  };
  visit(raw, 0);
  const first = records(raw)[0];
  if (first) visit(first, 1);
  return out;
}

export function findOwner(raws: unknown[]): Artifact["owner"] {
  let displayName: string | undefined;
  let handle: string | undefined;
  const links = new Set<string>();
  for (const raw of raws) {
    for (const o of ownerCandidates(raw)) {
      displayName ??= pick(o, NAME);
      handle ??= pick(o, HANDLE);
      for (const k of LINK) {
        const v = str(o[k]);
        if (v && /^https?:\/\//.test(v)) links.add(v);
      }
      for (const k of ["bio", "description", "signature"]) for (const m of str(o[k])?.match(URL_RE) ?? []) links.add(m);
    }
    if (isObj(raw) && Array.isArray(raw.links)) for (const l of raw.links) if (typeof l === "string" && /^https?:\/\//.test(l)) links.add(l);
  }
  if (!displayName && !handle && links.size === 0) return undefined;
  return { displayName, handle, links: [...links].slice(0, 200) };
}

export async function buildArtifact(
  input: { inputId: string; url: string; platform: string },
  steps: Step[],
  outcome: { status: ArtifactStatus; reason?: string },
): Promise<Artifact> {
  const base = { inputId: input.inputId, url: input.url, platform: input.platform, fields: {} };
  if (steps.length === 0) {
    return { ...base, extractor: "none", status: outcome.status === "extracted" ? "failed" : outcome.status, reason: outcome.reason ?? "no content was read", text: "", items: [] };
  }
  const raws = steps.map((s) => s.result.raw);
  const text = clip(steps.map((s) => s.result.text).join("\n\n"), 30_000);
  const items = raws.flatMap(records).map(toItem).filter((i): i is ArtifactItem => !!i).slice(0, 100);
  const snap = await saveSnapshot(JSON.stringify(raws), "json");
  const firstRaw = raws[0];
  const title = (isObj(firstRaw) && (pick(firstRaw, ["title", "name", "login"]))) || input.url;
  const source: Source = {
    id: newId("src"), url: input.url, title, fetchedAt: new Date().toISOString(),
    tool: "seeker-link", contentHash: snap.hash, snapshotKey: snap.key,
  };
  const last = steps.at(-1)!;
  return {
    ...base,
    extractor: extractorOf(last.tool),
    status: outcome.status,
    reason: outcome.reason,
    owner: findOwner(raws),
    text,
    fields: isObj(firstRaw) ? Object.fromEntries(Object.entries(firstRaw).filter(([, v]) => typeof v !== "object").slice(0, 40)) : {},
    items,
    source,
  };
}
