-- Cost rows are part of a research run's stored representation and must follow its lifecycle.
DELETE FROM cost_ledger c
 WHERE c.run_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM research_runs r WHERE r.id = c.run_id);

ALTER TABLE cost_ledger
  ADD CONSTRAINT cost_ledger_run_fk
  FOREIGN KEY (run_id) REFERENCES research_runs (id) ON DELETE CASCADE;
