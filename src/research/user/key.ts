import type { Vars } from "../../agent/recipes";

const parse = (url: string): { host: string; segs: string[] } => {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  return { host, segs };
};

/** Recipe key for a URL: host plus path shape, e.g. `url:soundcloud.com/{seg1}`. Query and values ignored. */
export function inputKey(url: string): string {
  const { host, segs } = parse(url);
  return `url:${host}${segs.map((_, i) => `/{seg${i + 1}}`).join("")}`;
}

/** Variables a recipe can use for this URL. */
export function varsFor(url: string): Vars {
  const { host, segs } = parse(url);
  const vars: Vars = { url, host };
  segs.forEach((s, i) => (vars[`seg${i + 1}`] = s));
  if (segs[0]) vars.handle = segs[0].replace(/^@/, "");
  return vars;
}

/** Short platform label from the host: github.com → github, m.soundcloud.com → soundcloud, unknown → web. */
export function platformOf(url: string): string {
  const { host } = parse(url);
  const known = ["github", "gitlab", "soundcloud", "tiktok", "instagram", "youtube", "behance", "dribbble", "linkedin", "x", "twitter", "medium", "substack", "bandcamp", "kaggle", "twitch", "vimeo", "spotify"];
  const parts = host.split(".");
  const hit = parts.find((p) => known.includes(p));
  if (hit) return hit === "twitter" ? "x" : hit;
  if (host === "youtu.be") return "youtube";
  return "web";
}
