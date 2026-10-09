-- Relevance is a verdict for one run's occupation, not a property of the shared ad: a marketing ad is
-- unrelated for a nurse but relevant for a marketer. Moves the flag from vacancies.data to run_vacancies.
ALTER TABLE run_vacancies ADD COLUMN irrelevant boolean NOT NULL DEFAULT false;
UPDATE vacancies SET data = data - 'irrelevant' WHERE data ? 'irrelevant';
