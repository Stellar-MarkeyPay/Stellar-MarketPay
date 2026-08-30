-- Issue #254 (phase 1) rollback: restore the pre-V16 trigger function
-- (title/description/skills only, no category weight) and recompute
-- job_search_vector for existing rows to match.

CREATE OR REPLACE FUNCTION update_job_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.job_search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(array_to_string(NEW.skills, ' '), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE jobs SET job_search_vector =
  setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(description, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(array_to_string(skills, ' '), '')), 'C');
