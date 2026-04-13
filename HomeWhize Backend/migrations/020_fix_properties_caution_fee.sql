-- Migration: Ensure caution_fee column exists in properties table
ALTER TABLE properties ADD COLUMN caution_fee DECIMAL(12,2) DEFAULT 0;
