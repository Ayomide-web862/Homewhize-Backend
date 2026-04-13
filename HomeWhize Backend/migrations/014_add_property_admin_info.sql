-- Add admin_name and admin_email columns to properties table
ALTER TABLE properties
  ADD COLUMN admin_name VARCHAR(255) DEFAULT NULL AFTER admin_id,
  ADD COLUMN admin_email VARCHAR(255) DEFAULT NULL AFTER admin_name;

-- Backfill existing properties with admin details (if admin_id is set)
UPDATE properties p
JOIN users u ON p.admin_id = u.id
SET p.admin_name = u.name,
    p.admin_email = u.email
WHERE p.admin_id IS NOT NULL;
