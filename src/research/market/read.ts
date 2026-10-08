// Read side for the API: companies and vacancies as API.md shapes them, internal fields stripped.
import type { Claim, Company, Vacancy, VacancySighting } from "../../contracts";
import { query } from "../../db/pool";

type CompanyRow = {
  id: string; name: string; domain: string | null; country: string;
  registry_ids: Company["registryIds"]; claims: Claim[]; ghost_signals: Claim[]; is_dream?: boolean;
};

const toCompany = (r: CompanyRow): Company => ({
  id: r.id, name: r.name, domain: r.domain ?? undefined, country: r.country, registryIds: r.registry_ids,
  isDreamCompany: r.is_dream ?? false, claims: r.claims, ghostSignals: r.ghost_signals,
});

type VacancyRow = {
  id: string; company_id: string; canonical_url: string; data: Record<string, unknown>;
  first_seen_at: Date; last_seen_at: Date; repost_count: number;
};

const toVacancy = (r: VacancyRow): Vacancy => {
  const d = r.data as Partial<Vacancy>;
  return {
    id: r.id,
    companyId: r.company_id,
    canonicalUrl: r.canonical_url,
    title: d.title ?? "",
    lang: d.lang ?? "und",
    occupation: d.occupation!,
    location: d.location!,
    requirements: d.requirements ?? [],
    salary: d.salary,
    postedAt: d.postedAt,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    repostCount: r.repost_count,
  };
};

export async function getCompany(id: string): Promise<Company | null> {
  const [row] = await query<CompanyRow>("SELECT * FROM companies WHERE id = $1", [id]);
  return row ? toCompany(row) : null;
}

export async function getVacancy(id: string, withSightings: boolean): Promise<(Vacancy & { sightings?: VacancySighting[] }) | null> {
  const [row] = await query<VacancyRow>("SELECT * FROM vacancies WHERE id = $1", [id]);
  if (!row) return null;
  const vacancy = toVacancy(row);
  if (!withSightings) return vacancy;
  const sightings = await query<{ seen_at: Date; url: string; content_hash: string; source: VacancySighting["source"] }>(
    "SELECT seen_at, url, content_hash, source FROM vacancy_sightings WHERE vacancy_id = $1 ORDER BY seen_at",
    [id],
  );
  return { ...vacancy, sightings: sightings.map((s) => ({ seenAt: s.seen_at.toISOString(), url: s.url, contentHash: s.content_hash, source: s.source })) };
}

export async function listRunCompanies(runId: string, page: number, pageSize: number): Promise<{ items: Company[]; total: number }> {
  const rows = await query<CompanyRow & { total: string }>(
    `SELECT c.*, rc.is_dream, count(*) OVER () AS total FROM run_companies rc JOIN companies c ON c.id = rc.company_id
     WHERE rc.run_id = $1 ORDER BY rc.is_dream DESC, c.name LIMIT $2 OFFSET $3`,
    [runId, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(toCompany), total: Number(rows[0]?.total ?? 0) };
}

export async function listRunVacancies(
  runId: string,
  filters: { occupation?: string; companyId?: string },
  page: number,
  pageSize: number,
): Promise<{ items: Vacancy[]; total: number }> {
  const rows = await query<VacancyRow & { total: string }>(
    `SELECT v.*, count(*) OVER () AS total FROM run_vacancies rv JOIN vacancies v ON v.id = rv.vacancy_id
     WHERE rv.run_id = $1 AND ($2::text IS NULL OR v.data->'occupation'->>'uri' = $2) AND ($3::text IS NULL OR v.company_id = $3)
     ORDER BY v.last_seen_at DESC LIMIT $4 OFFSET $5`,
    [runId, filters.occupation ?? null, filters.companyId ?? null, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(toVacancy), total: Number(rows[0]?.total ?? 0) };
}
