-- Add database integrity constraints for production safety

-- Add unique constraint on booking references to prevent duplicates
ALTER TABLE bookings
  ADD CONSTRAINT uk_bookings_booking_reference UNIQUE (booking_reference);

-- Add unique constraint on transaction references
ALTER TABLE transactions
  ADD CONSTRAINT uk_transactions_reference UNIQUE (reference);

-- Add unique constraint on booked dates to prevent double booking
ALTER TABLE booked_dates
  ADD CONSTRAINT uk_booked_dates_property_date UNIQUE (property_id, booked_date);

-- Add indexes for performance
CREATE INDEX idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX idx_bookings_check_out ON bookings(check_out);
CREATE INDEX idx_transactions_booking_reference ON transactions(booking_reference);
CREATE INDEX idx_transactions_status ON transactions(status);