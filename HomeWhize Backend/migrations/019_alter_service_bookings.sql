-- Migration: Alter service_bookings table to add missing columns
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS booking_reference VARCHAR(150) UNIQUE;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) NOT NULL DEFAULT 'Unknown';
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL DEFAULT 'unknown@example.com';
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS phone VARCHAR(100) NOT NULL DEFAULT '0000000000';
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(100) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS service_date DATE NOT NULL DEFAULT CURDATE();
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS service_time VARCHAR(50) NOT NULL DEFAULT '00:00';
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS property_type VARCHAR(100) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS room_count INT DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS urgency_level VARCHAR(100) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'NGN';
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS payment_status ENUM('unpaid','awaiting_payment','paid','failed','refunded') NOT NULL DEFAULT 'unpaid';
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS booking_status ENUM('pending','accepted','awaiting_payment','rejected','cancelled','in_progress','completed','confirmed') NOT NULL DEFAULT 'pending';
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS provider_response_note TEXT DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS paystack_reference VARCHAR(150) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS paid_at DATETIME DEFAULT NULL;