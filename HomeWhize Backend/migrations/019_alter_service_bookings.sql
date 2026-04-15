-- Migration: Alter service_bookings table to add missing columns
ALTER TABLE service_bookings ADD COLUMN booking_reference VARCHAR(150) UNIQUE;
ALTER TABLE service_bookings ADD COLUMN full_name VARCHAR(255) NOT NULL DEFAULT 'Unknown';
ALTER TABLE service_bookings ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT 'unknown@example.com';
ALTER TABLE service_bookings ADD COLUMN phone VARCHAR(100) NOT NULL DEFAULT '0000000000';
ALTER TABLE service_bookings ADD COLUMN alternate_phone VARCHAR(100) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN service_date DATE NOT NULL DEFAULT '2024-01-01';
ALTER TABLE service_bookings ADD COLUMN service_time VARCHAR(50) NOT NULL DEFAULT '00:00';
ALTER TABLE service_bookings ADD COLUMN property_type VARCHAR(100) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN room_count INT DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN urgency_level VARCHAR(100) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE service_bookings ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'NGN';
ALTER TABLE service_bookings ADD COLUMN payment_status ENUM('unpaid','awaiting_payment','paid','failed','refunded') NOT NULL DEFAULT 'unpaid';
ALTER TABLE service_bookings ADD COLUMN booking_status ENUM('pending','accepted','awaiting_payment','rejected','cancelled','in_progress','completed','confirmed') NOT NULL DEFAULT 'pending';
ALTER TABLE service_bookings ADD COLUMN provider_response_note TEXT DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN paystack_reference VARCHAR(150) DEFAULT NULL;
ALTER TABLE service_bookings ADD COLUMN paid_at DATETIME DEFAULT NULL;