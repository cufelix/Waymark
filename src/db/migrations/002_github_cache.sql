-- Cache of public GitHub API responses (no seeker data), so repeated research is fast and stays under rate limits.
CREATE TABLE github_cache (
  path        text PRIMARY KEY,
  status      integer NOT NULL,
  body        jsonb,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
