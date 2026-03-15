-- Migration: transactions table for payments logging
CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(255) NOT NULL,
  booking_reference VARCHAR(100),
  booking_id INT,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'NGN',
  status ENUM('pending','success','failed') DEFAULT 'pending',
  customer_email VARCHAR(255),
  provider_id INT,
  paystack_payload JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reference (reference),
  INDEX idx_booking_reference (booking_reference)
);
