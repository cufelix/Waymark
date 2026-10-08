// User research (Part 2): read every link the seeker gave, check ownership, extract proven skills.
import type { Claim, ResearchOptions, SeekerLink, SeekerProfile, SeekerResearch, SeekerResearchLink } from "../../contracts";
import { query } from "../../db/pool";
import { newId } from "../../ids";
import { errorMessage, log } from "../../log";
import { buildArtifact, type Artifact } from "./artifact";
import { platformOf } from "./key";
import { nameSearch } from "./nameSearch";
import { checkOwnership } from "./ownership";
import { readInput } from "./reader";
import { extractSkills } from "./skills";

const CONCURRENCY = 3;

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function safeRead(link: SeekerLink, runId: string): Promise<Artifact> {
  try {
    return (await readInput(link, runId)).artifact;
  } catch (err) {
    log.warn("reading a seeker link failed", { linkId: link.id, error: errorMessage(err) });
    return buildArtifact({ inputId: link.id, url: link.url, platform: platformOf(link.url) }, [], { status: "failed", reason: errorMessage(err) });
  }
}

export async function researchSeeker(
  profile: SeekerProfile,
  options: ResearchOptions,
  runId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SeekerResearch> {
  const links = profile.links;
  const total = links.length * 2; // reading, then skill extraction
  let done = 0;
  const tick = () => onProgress?.(++done, total);
  onProgress?.(0, total);

  const artifacts = await mapLimit(links, CONCURRENCY, async (link) => {
    const a = await safeRead(link, runId);
    await query("INSERT INTO artifacts (id, run_id, seeker_id, input_id, data) VALUES ($1, $2, $3, $4, $5)", [
      newId("art"), runId, profile.seekerId, link.id, JSON.stringify(a),
    ]);
    tick();
    return a;
  });

  const ownership = checkOwnership(artifacts, links, profile.seekerId);

  const results = await mapLimit(artifacts, CONCURRENCY, async (a): Promise<SeekerResearchLink> => {
    const owned = ownership[a.inputId] ?? "unconfirmed";
    let provenSkills: Claim[] = [];
    let reason = a.reason;
    if (a.status === "extracted" || a.status === "partial") {
      try {
        provenSkills = await extractSkills(a, profile, owned, runId);
      } catch (err) {
        reason = [reason, `skill extraction failed: ${errorMessage(err)}`].filter(Boolean).join("; ");
      }
    }
    tick();
    return {
      linkId: a.inputId,
      platform: a.platform,
      status: a.status,
      ...(reason ? { reason } : {}),
      ownership: owned,
      reachable: a.status === "extracted" || a.status === "partial",
      fetchedAt: a.source?.fetchedAt ?? new Date().toISOString(),
      provenSkills,
    };
  });

  // ponytail: SeekerProfile carries no name yet (API.md), so the opt-in name search is skipped until it does
  const candidates = await nameSearch(profile, options, undefined, runId);
  return { links: results, ...(candidates ? { nameSearch: candidates } : {}) };
}
