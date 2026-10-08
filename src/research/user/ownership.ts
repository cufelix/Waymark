// Light ownership check (docs/user-research.md §4): does a link plausibly belong to the seeker?
// Pure function. Without a signal, content still shows, but its skills stay "stated".
import type { SeekerLink } from "../../contracts";
import type { Artifact } from "./artifact";
import { platformOf, varsFor } from "./key";

export type Ownership = "confirmed" | "unconfirmed";

const norm = (h: string | undefined): string | undefined => {
  const v = h?.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
  return v && v.length >= 3 ? v : undefined;
};

/** host + path, lowercase, no www, no trailing slash: "github.com/jan". */
const normUrl = (url: string): string | undefined => {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    return u.hostname.toLowerCase().replace(/^www\./, "") + path;
  } catch {
    return undefined;
  }
};

/** True when `href` points at the link `target` (the same page, or a page under it; any page of a personal site). */
const pointsAt = (href: string, target: SeekerLink): boolean => {
  const h = normUrl(href);
  const t = normUrl(target.url);
  if (!h || !t) return false;
  if (platformOf(target.url) === "web") return h.split("/")[0] === t.split("/")[0];
  return h === t || h.startsWith(t + "/");
};

export function checkOwnership(artifacts: Artifact[], links: SeekerLink[]): Record<string, Ownership> {
  const read = new Map(artifacts.filter((a) => a.status === "extracted" || a.status === "partial").map((a) => [a.inputId, a]));
  const result: Record<string, Ownership> = Object.fromEntries(links.map((l) => [l.id, "unconfirmed" as Ownership]));
  const confirm = (...ids: string[]) => ids.forEach((id) => (result[id] = "confirmed"));

  // (a) the same handle on two or more different platforms
  const handles = links.map((l) => {
    const a = read.get(l.id);
    const platform = platformOf(l.url);
    return { id: l.id, platform, handle: norm(a?.owner?.handle) ?? (platform === "web" ? undefined : norm(varsFor(l.url).handle)) };
  });
  for (const x of handles) {
    for (const y of handles) {
      if (x.id !== y.id && x.handle && x.handle === y.handle && x.platform !== y.platform) confirm(x.id, y.id);
    }
  }

  // (b) one input links to another input the seeker gave us
  for (const from of links) {
    const outbound = read.get(from.id)?.owner?.links ?? [];
    for (const to of links) {
      if (to.id !== from.id && outbound.some((href) => pointsAt(href, to))) confirm(from.id, to.id);
    }
  }
  return result;
}
