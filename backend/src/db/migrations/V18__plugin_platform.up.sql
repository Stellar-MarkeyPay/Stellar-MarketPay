-- V18__plugin_platform.up.sql
-- Plugin platform for third-party marketplace extensions (Issue #322).
--
-- Data model summary (see docs/ADR-011-plugin-platform.md for the full
-- design):
--
--   plugins              One row per plugin identity (the manifest's `id`).
--                         Ownership, visibility (public vs. one
--                         organisation's private plugin), and status.
--   plugin_versions       Every submitted version: its manifest, its source
--                         (index.js — the only file the sandbox loads),
--                         and the automated security scan result that
--                         gates it from ever reaching review. Immutable
--                         once created — a new version is a new row, never
--                         an edit, so an installed version can never change
--                         under an installer without a new install.
--   plugin_installations   One row per (plugin version, installer). Records
--                         exactly which permission scopes the installer
--                         granted — the intersection of what the manifest
--                         requested and what the installer approved is
--                         computed at install time and stored here, so a
--                         later manifest change cannot silently expand an
--                         existing install's access.
--   plugin_invocation_logs Every sandboxed run: outcome, timing, and error
--                         detail if any — "a plugin crash is contained and
--                         reported" needs somewhere to report it *to*.

CREATE TABLE IF NOT EXISTS plugins (
  id               TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  name             TEXT NOT NULL,
  description      TEXT,
  author_address   TEXT NOT NULL REFERENCES profiles(public_key),
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  -- Set only for a private plugin: the one organisation (represented here
  -- by its owning wallet address, consistent with this codebase having no
  -- separate organisation entity) allowed to see and install it.
  org_address      TEXT REFERENCES profiles(public_key),
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'suspended')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (visibility = 'public' OR org_address IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS plugins_author_idx ON plugins(author_address);
CREATE INDEX IF NOT EXISTS plugins_status_visibility_idx ON plugins(status, visibility);

CREATE TABLE IF NOT EXISTS plugin_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id        TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  version          TEXT NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  manifest         JSONB NOT NULL,
  source           TEXT NOT NULL,
  scan_passed      BOOLEAN NOT NULL,
  scan_findings    JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_status    TEXT NOT NULL DEFAULT 'pending'
                     CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewed_by      TEXT REFERENCES profiles(public_key),
  reviewed_at      TIMESTAMPTZ,
  review_notes     TEXT,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plugin_id, version)
);

CREATE INDEX IF NOT EXISTS plugin_versions_plugin_idx ON plugin_versions(plugin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plugin_versions_review_status_idx ON plugin_versions(review_status);

-- Explicit rollback support (Issue #322: "implement versioning, update
-- distribution and rollback"): the plugin's currently-served version is
-- whichever approved plugin_versions row this points at. Publishing a new
-- version or rolling back to an old one is the same operation — moving
-- this pointer to an already-approved version — and never deletes or
-- rewrites the version rows themselves.
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS active_version_id UUID REFERENCES plugin_versions(id);

CREATE TABLE IF NOT EXISTS plugin_installations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id           TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  plugin_version_id   UUID NOT NULL REFERENCES plugin_versions(id),
  installer_address   TEXT NOT NULL REFERENCES profiles(public_key),
  granted_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uninstalled_at      TIMESTAMPTZ,
  UNIQUE (plugin_id, installer_address)
);

CREATE INDEX IF NOT EXISTS plugin_installations_installer_idx
  ON plugin_installations(installer_address) WHERE uninstalled_at IS NULL;
CREATE INDEX IF NOT EXISTS plugin_installations_plugin_idx ON plugin_installations(plugin_id);

CREATE TABLE IF NOT EXISTS plugin_invocation_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id   UUID NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
  hook_name         TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout')),
  duration_ms       INTEGER NOT NULL,
  error_code        TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plugin_invocation_logs_installation_idx
  ON plugin_invocation_logs(installation_id, created_at DESC);
