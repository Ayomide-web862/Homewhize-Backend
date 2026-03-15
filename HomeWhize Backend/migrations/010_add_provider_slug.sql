ALTER TABLE providers
  ADD COLUMN slug VARCHAR(255) NULL;
UPDATE providers p
JOIN (
  SELECT id, LOWER(CONCAT(REPLACE(company_name, ' ', '-'), '-', id)) AS new_slug
  FROM providers
  WHERE slug IS NULL OR slug = ''
) s ON p.id = s.id
SET p.slug = s.new_slug;

ALTER TABLE providers
  ADD UNIQUE INDEX idx_providers_slug (slug);
