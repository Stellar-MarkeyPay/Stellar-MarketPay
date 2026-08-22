-- V16__assessment_authoring.up.sql
-- Assessment authoring data model (Issue #267 Phase 1): a skill catalog with
-- per-skill scoring config, and a question bank, so assessments can be
-- authored and published without a deploy.

CREATE TABLE IF NOT EXISTS assessment_skills (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   TEXT NOT NULL UNIQUE,
  label                  TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published', 'archived')),
  pass_score             INTEGER NOT NULL DEFAULT 70
                           CHECK (pass_score BETWEEN 0 AND 100),
  duration_seconds       INTEGER NOT NULL DEFAULT 900
                           CHECK (duration_seconds > 0),
  cooldown_days          INTEGER NOT NULL DEFAULT 30
                           CHECK (cooldown_days >= 0),
  -- Forward-looking (Phase 2 adaptive selection): how many questions a single
  -- attempt should draw from the bank. NULL means "serve the whole bank",
  -- today's only behavior; nothing reads this column yet.
  questions_per_attempt  INTEGER
                           CHECK (questions_per_attempt IS NULL OR questions_per_attempt > 0),
  created_by             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assessment_skills_status_idx ON assessment_skills(status);

CREATE TABLE IF NOT EXISTS assessment_questions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id               UUID NOT NULL REFERENCES assessment_skills(id) ON DELETE CASCADE,
  question_text          TEXT NOT NULL CHECK (length(btrim(question_text)) > 0),
  options                JSONB NOT NULL
                           CHECK (jsonb_typeof(options) = 'array'
                                  AND jsonb_array_length(options) BETWEEN 2 AND 6),
  correct_option_index   INTEGER NOT NULL
                           CHECK (correct_option_index >= 0
                                  AND correct_option_index < jsonb_array_length(options)),
  -- Forward-looking (Phase 2 adaptive selection): no delivery logic reads
  -- difficulty yet, but authored content needs it tagged now so Phase 2
  -- doesn't have to retrofit every existing question.
  difficulty             TEXT NOT NULL DEFAULT 'intermediate'
                           CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  -- Forward-looking (Phase 2 selection / Phase 5 item analytics): sub-topic
  -- labels; nothing groups or filters on this yet.
  tags                   TEXT[] NOT NULL DEFAULT '{}',
  status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published', 'archived')),
  -- Bumped on every edit so a published question that's mid-edit reverts to
  -- draft rather than silently changing under an in-flight attempt. Also
  -- forward-looking: Phase 5 item analytics will need to know which version
  -- of a question a given historical attempt actually saw.
  version                INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS assessment_questions_skill_idx ON assessment_questions(skill_id);
CREATE INDEX IF NOT EXISTS assessment_questions_skill_status_idx
  ON assessment_questions(skill_id, status);
