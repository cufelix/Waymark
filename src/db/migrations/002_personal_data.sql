-- Durable personal-data stores, retention metadata and deletion retry state.

CREATE TABLE seeker_records (
  seeker_id    text PRIMARY KEY,
  record       jsonb NOT NULL,
  intake       jsonb,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seeker_records_expiry ON seeker_records (expires_at);

CREATE TABLE validations (
  validation_id text PRIMARY KEY,
  seeker_id     text NOT NULL,
  data          jsonb NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX validations_seeker ON validations (seeker_id);
CREATE INDEX validations_expiry ON validations (expires_at);

CREATE TABLE roadmaps (
  roadmap_id  text PRIMARY KEY,
  seeker_id  text NOT NULL,
  data       jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roadmaps_seeker ON roadmaps (seeker_id);
CREATE INDEX roadmaps_expiry ON roadmaps (expires_at);

ALTER TABLE research_runs ADD COLUMN expires_at timestamptz;
UPDATE research_runs
   SET expires_at = created_at
     + (current_setting('waymark.personal_data_retention_days')::integer * interval '1 day');
ALTER TABLE research_runs ALTER COLUMN expires_at SET NOT NULL;
CREATE INDEX research_runs_expiry ON research_runs (expires_at);

CREATE TABLE seeker_deletion_jobs (
  seeker_id       text PRIMARY KEY,
  attempts        integer NOT NULL DEFAULT 0,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seeker_deletion_jobs_due ON seeker_deletion_jobs (next_attempt_at);
