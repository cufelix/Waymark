-- Research service schema. Everything about one seeker is keyed by seeker_id so it can be exported and hard-deleted.

CREATE TABLE research_runs (
  id              text PRIMARY KEY,
  seeker_id       text NOT NULL,
  profile_version integer NOT NULL,
  profile         jsonb NOT NULL,
  options         jsonb NOT NULL,
  status          text NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
  progress        jsonb NOT NULL DEFAULT '[]',
  error           jsonb,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX research_runs_seeker ON research_runs (seeker_id);

-- What we read from each seeker input (link or document), with its source snapshot.
CREATE TABLE artifacts (
  id          text PRIMARY KEY,
  run_id      text NOT NULL REFERENCES research_runs (id) ON DELETE CASCADE,
  seeker_id   text NOT NULL,
  input_id    text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_seeker ON artifacts (seeker_id);

-- How to read a kind of input, learned by the agent and replayed afterwards.
CREATE TABLE recipes (
  key              text PRIMARY KEY,
  steps            jsonb NOT NULL,
  output_map       jsonb NOT NULL DEFAULT '{}',
  expected_shape   jsonb NOT NULL DEFAULT '[]',
  runs             integer NOT NULL DEFAULT 0,
  successes        integer NOT NULL DEFAULT 0,
  last_success_at  timestamptz,
  usd_per_run      numeric NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'learned' CHECK (status IN ('learned','pinned','disabled')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  name_key      text NOT NULL,            -- normalised name for de-duplication
  domain        text,
  country       text NOT NULL,
  registry_ids  jsonb NOT NULL DEFAULT '[]',
  claims        jsonb NOT NULL DEFAULT '[]',
  ghost_signals jsonb NOT NULL DEFAULT '[]',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name_key, country)
);

CREATE TABLE vacancies (
  id             text PRIMARY KEY,
  company_id     text NOT NULL REFERENCES companies (id),
  canonical_url  text NOT NULL UNIQUE,
  content_hash   text NOT NULL,
  data           jsonb NOT NULL,           -- Vacancy without the history fields
  first_seen_at  timestamptz NOT NULL,
  last_seen_at   timestamptz NOT NULL,
  repost_count   integer NOT NULL DEFAULT 0
);

CREATE TABLE vacancy_sightings (
  vacancy_id    text NOT NULL REFERENCES vacancies (id) ON DELETE CASCADE,
  seen_at       timestamptz NOT NULL,
  url           text NOT NULL,
  content_hash  text NOT NULL,
  source        text NOT NULL
);
CREATE INDEX vacancy_sightings_vacancy ON vacancy_sightings (vacancy_id);

CREATE TABLE run_companies (
  run_id      text NOT NULL REFERENCES research_runs (id) ON DELETE CASCADE,
  company_id  text NOT NULL REFERENCES companies (id),
  is_dream    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, company_id)
);

CREATE TABLE run_vacancies (
  run_id      text NOT NULL REFERENCES research_runs (id) ON DELETE CASCADE,
  vacancy_id  text NOT NULL REFERENCES vacancies (id),
  PRIMARY KEY (run_id, vacancy_id)
);

-- Every paid call. Monthly caps are enforced from this table.
CREATE TABLE cost_ledger (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  tool       text NOT NULL,
  units      numeric NOT NULL,
  usd        numeric NOT NULL,
  run_id     text,
  detail     text
);
CREATE INDEX cost_ledger_tool_at ON cost_ledger (tool, at);
CREATE INDEX cost_ledger_run ON cost_ledger (run_id);
