-- Migration for OTP and Password Reset Support
-- Run this migration to add OTP columns to the users table

-- Add OTP columns to users table
-- Add OTP columns to users table (idempotent where supported)
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `otp` VARCHAR(10) NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `otp_expire` DATETIME NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `reset_token_expire` DATETIME NULL;

-- Add indexes for better query performance (MySQL may error if index exists; runner treats duplicates as non-fatal)
ALTER TABLE `users` ADD INDEX `idx_otp` (`otp`);
ALTER TABLE `users` ADD INDEX `idx_reset_token` (`reset_token`);
