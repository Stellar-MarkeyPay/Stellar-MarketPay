-- Issue #254 (phase 1): extend job_search_vector to include category
-- V11 weighted title/description/skills (A/B/C) but left category out of
-- the index entirely, so a search for a category name (e.g. "Smart
-- Contracts") only matched via the unrelated category = $n filter, never
-- via full-text search. Add category as weight 'D' (see ADR-009).

CREATE OR REPLACE FUNCTION update_job_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.job_search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(array_to_string(NEW.skills, ' '), '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(NEW.category, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing rows so category terms are searchable immediately,
-- without waiting for each job's next write to fire the trigger.
UPDATE jobs SET job_search_vector =
  setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(description, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(array_to_string(skills, ' '), '')), 'C') ||
  setweight(to_tsvector('simple', COALESCE(category, '')), 'D');
