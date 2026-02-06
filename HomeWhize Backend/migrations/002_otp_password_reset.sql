-- Migration for OTP and Password Reset Support
-- Run this migration to add OTP columns to the users table

-- Add OTP columns to users table
ALTER TABLE `users` ADD COLUMN `otp` VARCHAR(10) NULL;
ALTER TABLE `users` ADD COLUMN `otp_expire` DATETIME NULL;
ALTER TABLE `users` ADD COLUMN `reset_token_expire` DATETIME NULL;

-- Add indexes for better query performance
ALTER TABLE `users` ADD INDEX `idx_otp` (`otp`);
ALTER TABLE `users` ADD INDEX `idx_reset_token` (`reset_token`);
