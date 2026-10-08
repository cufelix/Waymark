import { sha256 } from "../../ids";
// Light ownership check (docs/user-research.md §4): does a link plausibly belong to the seeker?
// Pure function. Without a signal, content still shows, but its skills stay "stated".
import type { SeekerLink } from "../../contracts";
import type { Artifact } from "./artifact";
import { platformOf } from "./key";

export type Ownership = "confirmed" | "unconfirmed";

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

// Hosts where many people share one domain and the account is the first path segment ("medium.com/@jan").
// A link to the bare host proves nothing, and a link needs the same first segment to point at the same account.
// Per-account subdomains (jan.github.io, jan.substack.com, jan.notion.site) are not listed: the host alone is the account.
const SHARED_HOSTS = new Set([
  "linktr.ee", "sites.google.com", "notion.site", "medium.com", "substack.com", "github.com", "gitlab.com", "linkedin.com",
  "twitter.com", "x.com", "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "soundcloud.com", "behance.net",
  "dribbble.com", "google.com", "wikipedia.org", "bsky.app", "mastodon.social",
]);

/** True when `href` points at the account behind the link `target`. */
const pointsAt = (href: string, target: SeekerLink): boolean => {
  const h = normUrl(href);
  const t = normUrl(target.url);
  if (!h || !t) return false;
  const [hHost = "", ...hPath] = h.split("/").filter(Boolean);
  const [tHost = "", ...tPath] = t.split("/").filter(Boolean);
  if (hHost !== tHost) return false;
  if (SHARED_HOSTS.has(tHost)) return tPath.length > 0 && hPath[0] === tPath[0];
  if (platformOf(target.url) === "web") return true; // own domain or per-account subdomain: any page of it
  return h === t || h.startsWith(t + "/");
};

/** The code a seeker puts in a bio or page they control to prove it is theirs. Derived from the seeker id, so it can't be guessed for another seeker. */
export const proofToken = (seekerId: string): string => `ethera-${sha256(`ethera-proof:${seekerId}`).slice(0, 10)}`;

/**
 * Confirmed only when tied to this seeker: the page shows the seeker's proof token, or it links both ways with a
 * page that does. Mutual links alone only prove two accounts belong to the same person, not to the seeker
 * (a seeker could submit a stranger's GitHub and that stranger's own site). One-way links and shared handles never confirm.
 */
export function checkOwnership(artifacts: Artifact[], links: SeekerLink[], seekerId: string): Record<string, Ownership> {
  const read = new Map(artifacts.filter((a) => a.status === "extracted" || a.status === "partial").map((a) => [a.inputId, a]));
  const result: Record<string, Ownership> = Object.fromEntries(links.map((l) => [l.id, "unconfirmed" as Ownership]));
  const token = proofToken(seekerId);
  const showsToken = (l: SeekerLink) => {
    const a = read.get(l.id);
    return !!a && (a.text.includes(token) || JSON.stringify(a.owner ?? {}).includes(token));
  };
  const linksTo = (from: SeekerLink, to: SeekerLink) => (read.get(from.id)?.owner?.links ?? []).some((href) => pointsAt(href, to));

  // Anchors: pages showing the token. Then spread along mutual links, so one token covers a seeker's linked profiles.
  const queue = links.filter(showsToken);
  for (const l of queue) result[l.id] = "confirmed";
  while (queue.length) {
    const a = queue.shift()!;
    for (const b of links) {
      if (result[b.id] !== "confirmed" && linksTo(a, b) && linksTo(b, a)) {
        result[b.id] = "confirmed";
        queue.push(b);
      }
    }
  }
  return result;
}
