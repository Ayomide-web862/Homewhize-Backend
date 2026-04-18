-- Add cancellation fields to bookings table

ALTER TABLE bookings
  ADD COLUMN cancelled_at DATETIME NULL,
  ADD COLUMN cancelled_by INT NULL;

-- Add index for cancelled_at
CREATE INDEX idx_bookings_cancelled_at ON bookings(cancelled_at);