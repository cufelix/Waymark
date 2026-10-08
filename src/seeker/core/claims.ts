import { createHash } from "node:crypto";
import type { Claim, Skill, Source } from "../contracts.ts";
import { newId } from "./ids.ts";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// API.md "Sources without a web URL": seeker-upload://doc_… and seeker-interview://skr_…#turn-N.
export function cvSource(documentId: string, fileName: string, fileBytes: Uint8Array, quote?: string): Source {
  return {
    id: newId("src"),
    url: `seeker-upload://${documentId}`,
    title: `CV: ${fileName}`,
    fetchedAt: now(),
    tool: "seeker-upload",
    contentHash: sha256(fileBytes),
    ...(quote ? { quote } : {}),
  };
}

export function interviewSource(seekerId: string, turnIndex: number, turnText: string, quote?: string): Source {
  return {
    id: newId("src"),
    url: `seeker-interview://${seekerId}#turn-${turnIndex}`,
    title: `Interview turn ${turnIndex}`,
    fetchedAt: now(),
    tool: "seeker-interview",
    contentHash: sha256(turnText),
    ...(quote ? { quote } : {}),
  };
}

// A skill the seeker says they have. Tier "stated" never counts as proof (PLAN.md §5.7).
export function statedSkillClaim(seekerId: string, skill: Skill, source: Source): Claim {
  return {
    id: newId("clm"),
    subject: { kind: "seeker", id: seekerId },
    statement: `States skill: ${skill.label}`,
    skill,
    kind: "fact",
    tier: "stated",
    sources: [source],
  };
}
