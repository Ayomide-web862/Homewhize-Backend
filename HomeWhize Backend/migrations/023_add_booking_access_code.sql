-- Add access_code column to bookings table for booking verification codes

ALTER TABLE bookings ADD COLUMN access_code VARCHAR(50) NULL AFTER owner_transfer_reference;

-- Add index for access_code
CREATE INDEX idx_bookings_access_code ON bookings(access_code);