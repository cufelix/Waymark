import { describe, expect, it } from "vitest";
import type { SeekerLink } from "../../../src/contracts";
import type { Artifact } from "../../../src/research/user/artifact";
import { checkOwnership } from "../../../src/research/user/ownership";

const link = (id: string, url: string): SeekerLink => ({ id, url, addedAt: "2026-10-08T00:00:00Z" });
const art = (inputId: string, owner?: Artifact["owner"], status: Artifact["status"] = "extracted"): Artifact => ({
  inputId, url: "", platform: "web", extractor: "fetch", status, owner, text: "x", fields: {}, items: [],
});

describe("checkOwnership", () => {
  it("a single link stays unconfirmed", () => {
    const links = [link("lnk_1", "https://github.com/jan")];
    expect(checkOwnership([art("lnk_1", { handle: "jan", links: [] })], links)).toEqual({ lnk_1: "unconfirmed" });
  });

  it("the same handle on two platforms confirms both", () => {
    const links = [link("lnk_1", "https://github.com/jancuts"), link("lnk_2", "https://www.tiktok.com/@JanCuts")];
    expect(checkOwnership([art("lnk_1"), art("lnk_2")], links)).toEqual({ lnk_1: "confirmed", lnk_2: "confirmed" });
  });

  it("the same handle twice on one platform proves nothing", () => {
    const links = [link("lnk_1", "https://github.com/jancuts"), link("lnk_2", "https://github.com/jancuts/repo")];
    expect(checkOwnership([art("lnk_1"), art("lnk_2")], links)).toEqual({ lnk_1: "unconfirmed", lnk_2: "unconfirmed" });
  });

  it("a profile linking to another given input confirms both", () => {
    const links = [link("lnk_1", "https://soundcloud.com/beats-by-x"), link("lnk_2", "https://jan.dev")];
    const arts = [art("lnk_1", { links: ["https://www.jan.dev/about"] }), art("lnk_2")];
    expect(checkOwnership(arts, links)).toEqual({ lnk_1: "confirmed", lnk_2: "confirmed" });
  });

  it("links from failed reads don't count", () => {
    const links = [link("lnk_1", "https://soundcloud.com/a1b2"), link("lnk_2", "https://jan.dev")];
    const arts = [art("lnk_1", { links: ["https://jan.dev"] }, "failed"), art("lnk_2")];
    expect(checkOwnership(arts, links)).toEqual({ lnk_1: "unconfirmed", lnk_2: "unconfirmed" });
  });
});
