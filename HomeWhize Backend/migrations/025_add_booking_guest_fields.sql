-- Add missing booking fields for guest information

ALTER TABLE bookings
  ADD COLUMN full_name VARCHAR(255) NULL AFTER user_id,
  ADD COLUMN email VARCHAR(255) NULL AFTER full_name,
  ADD COLUMN phone VARCHAR(20) NULL AFTER email,
  ADD COLUMN price_per_night DECIMAL(12,2) NULL AFTER phone,
  ADD COLUMN nights INT NULL AFTER price_per_night;

-- Add indexes for the new fields
CREATE INDEX idx_bookings_email ON bookings(email);
CREATE INDEX idx_bookings_phone ON bookings(phone);