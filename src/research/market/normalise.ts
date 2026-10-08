// Pure helpers shared by the market research steps.

const LEGAL_SUFFIXES = [
  "spol s ro", "sp z oo", "pty ltd", "sro", "as", "gmbh", "ag", "ltd", "limited", "inc", "incorporated",
  "llc", "plc", "corp", "corporation", "co", "sa", "sas", "srl", "spa", "bv", "nv", "oy", "ab", "kft", "pty", "se", "kg",
];

/** Lowercase name without accents, punctuation or trailing legal forms ("Acme s.r.o." → "acme"). */
export function normaliseCompanyName(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (s.endsWith(` ${suffix}`)) {
        s = s.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}

const TRACKING = /^(utm_.*|fbclid|gclid|msclkid|ref|refid|trk|trackingid|src|source|from|campaign)$/i;

/** URL without tracking parameters, fragment or trailing slash, so the same ad has one key. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    u.search = new URLSearchParams(kept).toString();
    return u.toString().replace(/\/(?=$|\?)/, "");
  } catch {
    return raw.trim();
  }
}

const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** True when the quote really appears in the text (case and whitespace insensitive). */
export const quoteInText = (quote: string, text: string): boolean =>
  squash(quote).length >= 3 && squash(text).includes(squash(quote));

/** Reads a dot path ("a.b.0.c") from an object. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), obj);
}

export const countryName = (code: string): string => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};
