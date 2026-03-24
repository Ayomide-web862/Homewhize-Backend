-- Add caution_fee column to properties table
ALTER TABLE properties ADD COLUMN caution_fee INT DEFAULT 0 AFTER price;

-- Create index for caution_fee if needed
CREATE INDEX idx_caution_fee ON properties(caution_fee);
