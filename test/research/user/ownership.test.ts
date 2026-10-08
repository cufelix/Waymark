import { describe, expect, it } from "vitest";
import type { SeekerLink } from "../../../src/contracts";
import { findOwner, type Artifact } from "../../../src/research/user/artifact";
import { checkOwnership, proofToken } from "../../../src/research/user/ownership";

const SKR = "skr_test_owner";

const link = (id: string, url: string): SeekerLink => ({ id, url, addedAt: "2026-10-08T00:00:00Z" });
const art = (inputId: string, owner?: Artifact["owner"], status: Artifact["status"] = "extracted"): Artifact => ({
  inputId, url: "", platform: "web", extractor: "fetch", status, owner, text: "x", fields: {}, items: [],
});
const both = { lnk_1: "confirmed", lnk_2: "confirmed" };
const none = { lnk_1: "unconfirmed", lnk_2: "unconfirmed" };

describe("checkOwnership", () => {
  it("a single link stays unconfirmed", () => {
    const links = [link("lnk_1", "https://github.com/jan")];
    expect(checkOwnership([art("lnk_1", { handle: "jan", links: [] })], links, SKR)).toEqual({ lnk_1: "unconfirmed" });
  });

  it("spoof: mutual links alone don't prove the accounts are the seeker's (a stranger's GitHub and site link to each other)", () => {
    const links = [link("lnk_1", "https://soundcloud.com/beats-by-x"), link("lnk_2", "https://jan.dev")];
    const arts = [art("lnk_1", { links: ["https://www.jan.dev/about"] }), art("lnk_2", { links: ["https://soundcloud.com/beats-by-x/tracks"] })];
    expect(checkOwnership(arts, links, SKR)).toEqual(none);
  });

  it("the seeker's proof token confirms that page, and mutual links spread it to the linked profile", () => {
    const links = [link("lnk_1", "https://soundcloud.com/beats-by-x"), link("lnk_2", "https://jan.dev")];
    const arts = [
      art("lnk_1", { links: ["https://www.jan.dev/about"], bio: `making beats · ${proofToken(SKR)}` }),
      art("lnk_2", { links: ["https://soundcloud.com/beats-by-x/tracks"] }),
    ];
    expect(checkOwnership(arts, links, SKR)).toEqual(both);
  });

  it("spoof: the token in page text (e.g. a comment on a stranger's video) proves nothing", () => {
    const links = [link("lnk_1", "https://www.youtube.com/@stranger")];
    const arts = [{ ...art("lnk_1", { handle: "stranger", links: [] }), text: `great video! ${proofToken(SKR)}` }];
    expect(checkOwnership(arts, links, SKR)).toEqual({ lnk_1: "unconfirmed" });
  });

  it("spoof: another seeker's token proves nothing for this seeker", () => {
    const links = [link("lnk_1", "https://jan.dev")];
    const arts = [art("lnk_1", { links: [], bio: proofToken("skr_someone_else") })];
    expect(checkOwnership(arts, links, SKR)).toEqual({ lnk_1: "unconfirmed" });
  });

  it("spoof: a one-way link to a victim confirms nothing", () => {
    const links = [link("lnk_1", "https://github.com/attacker"), link("lnk_2", "https://github.com/victim")];
    expect(checkOwnership([art("lnk_1", { links: ["https://github.com/victim"] }), art("lnk_2", { links: [] })], links, SKR)).toEqual(none);
  });

  it("spoof: the other direction alone confirms nothing either", () => {
    const links = [link("lnk_1", "https://jan.dev"), link("lnk_2", "https://github.com/jan")];
    expect(checkOwnership([art("lnk_1"), art("lnk_2", { links: ["https://jan.dev"] })], links, SKR)).toEqual(none);
  });

  it("spoof: same handle on two platforms is only a hint", () => {
    const links = [link("lnk_1", "https://github.com/jancuts"), link("lnk_2", "https://www.tiktok.com/@jancuts")];
    const arts = [art("lnk_1", { handle: "jancuts", links: [] }), art("lnk_2", { handle: "jancuts", links: [] })];
    expect(checkOwnership(arts, links, SKR)).toEqual(none);
  });

  describe("shared hosts", () => {
    it("a link to the bare host does not point at an account on it", () => {
      const links = [link("lnk_1", "https://jan.dev"), link("lnk_2", "https://linktr.ee/jan")];
      const arts = [art("lnk_1", { links: ["https://linktr.ee/jan"] }), art("lnk_2", { links: ["https://linktr.ee"] })];
      expect(checkOwnership(arts, links, SKR)).toEqual(none);
    });

    it("another account on a shared host does not match", () => {
      const links = [link("lnk_1", "https://jan.dev"), link("lnk_2", "https://medium.com/@jan")];
      const arts = [art("lnk_1", { links: ["https://medium.com/@victim"] }), art("lnk_2", { links: ["https://jan.dev"] })];
      expect(checkOwnership(arts, links, SKR)).toEqual(none);
    });

    it("the same account on a shared host matches (mutual)", () => {
      const links = [link("lnk_1", "https://jan.dev"), link("lnk_2", "https://medium.com/@jan")];
      const arts = [art("lnk_1", { links: ["https://medium.com/@jan/post-1"], bio: proofToken(SKR) }), art("lnk_2", { links: ["https://jan.dev"] })];
      expect(checkOwnership(arts, links, SKR)).toEqual(both);
    });

    it("a seeker link to a bare big host is never pointed at", () => {
      const links = [link("lnk_1", "https://jan.dev"), link("lnk_2", "https://github.com")];
      const arts = [art("lnk_1", { links: ["https://github.com/anyone"] }), art("lnk_2", { links: ["https://jan.dev"] })];
      expect(checkOwnership(arts, links, SKR)).toEqual(none);
    });

    it("per-account subdomains match on host alone", () => {
      const links = [link("lnk_1", "https://jan.github.io"), link("lnk_2", "https://jan.substack.com")];
      const arts = [art("lnk_1", { links: ["https://jan.substack.com/p/x"], bio: proofToken(SKR) }), art("lnk_2", { links: ["https://jan.github.io/"] })];
      expect(checkOwnership(arts, links, SKR)).toEqual(both);
      const other = [art("lnk_1", { links: ["https://victim.substack.com"], bio: proofToken(SKR) }), art("lnk_2", { links: ["https://jan.github.io/"] })];
      expect(checkOwnership(other, links, SKR)).toEqual({ lnk_1: "confirmed", lnk_2: "unconfirmed" });
    });
  });

  it("links from failed reads don't count", () => {
    const links = [link("lnk_1", "https://soundcloud.com/a1b2"), link("lnk_2", "https://jan.dev")];
    const arts = [art("lnk_1", { links: ["https://jan.dev"] }, "failed"), art("lnk_2", { links: ["https://soundcloud.com/a1b2"] })];
    expect(checkOwnership(arts, links, SKR)).toEqual(none);
  });
});

describe("findOwner links come from profile-level keys only", () => {
  it("takes website, blog and bio links from the profile", () => {
    const o = findOwner([{ login: "jan", blog: "https://jan.dev", bio: "see https://jan.dev/cv" }]);
    expect(o?.links).toEqual(expect.arrayContaining(["https://jan.dev", "https://jan.dev/cv"]));
  });

  it("ignores repo, video and post descriptions and the first record's own homepage", () => {
    const o = findOwner([
      { login: "jan", items: [{ name: "repo", description: "fork of https://github.com/victim/x", homepage: "https://victim.example", owner: { login: "jan" } }] },
    ]);
    expect(o?.links ?? []).toEqual([]);
  });
});
