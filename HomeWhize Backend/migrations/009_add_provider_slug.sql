-- Migration: add slug column to providers and backfill values

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS slug VARCHAR(255) DEFAULT NULL;

-- Backfill slug using company_name and id to ensure uniqueness
UPDATE providers
SET slug = LOWER(CONCAT(REPLACE(company_name, ' ', '-'), '-', id))
WHERE slug IS NULL OR slug = '';

-- Add unique index on slug
ALTER TABLE providers
  ADD UNIQUE INDEX IF NOT EXISTS idx_providers_slug (slug);
