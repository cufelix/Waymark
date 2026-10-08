import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/llm", () => ({
  chatJson: vi.fn(async () => ({
    value: {
      skills: [
        { label: "Rust", quote: "a  kernel module in RUST", statement: "Writes Rust" },
        { label: "Kubernetes", quote: "runs huge k8s clusters", statement: "Invented" },
      ],
    },
    usd: 0,
  })),
}));
vi.mock("../../../src/shared/taxonomy", () => ({
  resolveSkill: vi.fn(async (label: string) => ({ uri: `custom:${label.toLowerCase()}`, label, lang: "en" })),
}));

import type { SeekerProfile } from "../../../src/contracts";
import type { Artifact } from "../../../src/research/user/artifact";
import { extractSkills, keepVerbatim } from "../../../src/research/user/skills";

const profile = {
  seekerId: "skr_1",
  preferences: { targetOccupations: [{ uri: "u", label: "software developer", lang: "en" }], languages: [] },
} as unknown as SeekerProfile;

const artifact: Artifact = {
  inputId: "lnk_1", url: "https://github.com/jan", platform: "github", extractor: "official-api", status: "extracted",
  text: "Repos:\nWrote a kernel module in Rust for fun.", fields: {}, items: [],
  source: { id: "src_1", url: "https://github.com/jan", title: "jan", fetchedAt: "2026-10-08T00:00:00Z", tool: "seeker-link", contentHash: "h", snapshotKey: "k" },
};

describe("skills", () => {
  it("drops skills whose quote is not in the content", () => {
    expect(keepVerbatim([{ quote: "kernel  MODULE" }, { quote: "not there" }], "a kernel module")).toEqual([{ quote: "kernel  MODULE" }]);
  });

  it("builds claims only from verbatim quotes, tiered by ownership", async () => {
    const proven = await extractSkills(artifact, profile, "confirmed");
    expect(proven).toHaveLength(1);
    expect(proven[0]).toMatchObject({ tier: "single-source", kind: "fact", skill: { label: "Rust" }, subject: { kind: "seeker", id: "skr_1" } });
    expect(proven[0]!.sources[0]).toMatchObject({ quote: "a  kernel module in RUST", tool: "seeker-link", snapshotKey: "k" });

    const stated = await extractSkills(artifact, profile, "unconfirmed");
    expect(stated[0]!.tier).toBe("stated");
  });
});
