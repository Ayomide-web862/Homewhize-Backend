-- Migration: service bookings table
CREATE TABLE IF NOT EXISTS service_bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider_id INT NOT NULL,
  service_id INT NOT NULL,
  user_id INT NOT NULL,
  booking_date DATE,
  booking_time VARCHAR(20),
  address TEXT,
  notes TEXT,
  status ENUM('Pending','Accepted','Rejected','Completed') DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_provider_id (provider_id),
  INDEX idx_user_id (user_id)
);
