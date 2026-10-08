// gleif_search: free global legal-entity register (LEI). The "verified" tier for company identity.
import type { Tool } from "./types";
import { USER_AGENT } from "./web";

export type LeiRecord = { lei: string; legalName: string; country: string; status: string; registeredAt?: string; url: string };

type GleifRecord = {
  id: string;
  attributes: {
    entity: { legalName: { name: string } | string; legalAddress?: { country?: string }; status?: string };
    registration?: { initialRegistrationDate?: string };
  };
};

export function mapLeiRecord(r: GleifRecord): LeiRecord {
  const e = r.attributes.entity;
  return {
    lei: r.id,
    legalName: typeof e.legalName === "string" ? e.legalName : e.legalName.name,
    country: e.legalAddress?.country ?? "",
    status: e.status ?? "",
    registeredAt: r.attributes.registration?.initialRegistrationDate,
    url: `https://search.gleif.org/#/record/${r.id}`,
  };
}

const API = "https://api.gleif.org/api/v1";
const get = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { headers: { Accept: "application/vnd.api+json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GLEIF HTTP ${res.status}`);
  return (await res.json()) as T;
};

export const gleifSearch: Tool<{ name: string; country?: string }> = {
  name: "gleif_search",
  description:
    "Free. Looks up a company in the global LEI register (GLEIF) by legal name, optionally filtered by ISO country code. Returns LEI, legal name, country and status. Use to confirm a company's legal identity.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Company legal name" },
      country: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. 'DE'" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  available: () => true,
  async run({ name, country }) {
    const params = new URLSearchParams({ "filter[entity.legalName]": name, "page[size]": "5" });
    if (country) params.set("filter[entity.legalAddress.country]", country.toUpperCase());
    let records = (await get<{ data: GleifRecord[] }>(`${API}/lei-records?${params}`)).data.map(mapLeiRecord);

    if (records.length === 0) {
      const fuzzy = await get<{ data: { relationships?: { "lei-records"?: { data?: { id: string } } } }[] }>(
        `${API}/fuzzycompletions?${new URLSearchParams({ field: "entity.legalName", q: name })}`,
      );
      const ids = fuzzy.data.map((f) => f.relationships?.["lei-records"]?.data?.id).filter((id): id is string => !!id).slice(0, 5);
      if (ids.length) {
        const byId = new URLSearchParams({ "filter[lei]": ids.join(","), "page[size]": "5" });
        records = (await get<{ data: GleifRecord[] }>(`${API}/lei-records?${byId}`)).data.map(mapLeiRecord);
        if (country) records = records.filter((r) => r.country === country.toUpperCase());
      }
    }
    const text = records.map((r) => `${r.lei} | ${r.legalName} | ${r.country} | ${r.status}`).join("\n") || "No LEI records found.";
    return { raw: records, text, usd: 0 };
  },
};
