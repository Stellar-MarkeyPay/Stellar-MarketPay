-- V16__archived_job_status.up.sql
-- Add 'archived' to the jobs status enum and update related constraints.

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'archived';
