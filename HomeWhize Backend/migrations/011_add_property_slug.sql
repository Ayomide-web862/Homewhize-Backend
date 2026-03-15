-- Migration: add slug column to properties and backfill values

ALTER TABLE properties
  ADD COLUMN slug VARCHAR(255) DEFAULT NULL;

-- Backfill slug using a normalized name + id to ensure uniqueness
UPDATE properties
SET slug = LOWER(CONCAT(
  REPLACE(REPLACE(REPLACE(name, '\r', ''), '\n', ''), ' ', '-'),
  '-',
  id
))
WHERE slug IS NULL OR slug = '';

-- Add unique index on slug
ALTER TABLE properties
  ADD UNIQUE INDEX idx_properties_slug (slug);
