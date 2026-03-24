-- Migration: booked_dates table for tracking property availability
CREATE TABLE IF NOT EXISTS booked_dates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  booking_id INT,
  booked_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_property_id (property_id),
  INDEX idx_booked_date (booked_date),
  INDEX idx_property_date (property_id, booked_date),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);
