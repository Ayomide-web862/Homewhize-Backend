-- Add caution_fee column to bookings table
ALTER TABLE bookings ADD COLUMN caution_fee INT DEFAULT 0 AFTER total_amount;

-- Create index for caution_fee if needed
CREATE INDEX idx_bookings_caution_fee ON bookings(caution_fee);