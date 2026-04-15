-- Add Bank Details to KYC Requests Table
-- This migration adds bank_name and account_number columns to the kyc_requests table

-- Add bank detail columns if they don't exist (idempotent on newer MySQL/MariaDB)
ALTER TABLE `kyc_requests` ADD COLUMN `bank_name` VARCHAR(255) DEFAULT NULL AFTER `address`;
ALTER TABLE `kyc_requests` ADD COLUMN `account_number` VARCHAR(50) DEFAULT NULL AFTER `bank_name`;

-- Add indexes for quick lookups (duplicate index errors are non-fatal in runner)
ALTER TABLE `kyc_requests` ADD INDEX `idx_bank_name` (`bank_name`);
ALTER TABLE `kyc_requests` ADD INDEX `idx_account_number` (`account_number`);

-- Verify the table structure (optional: run this to check)
-- DESCRIBE `kyc_requests`;
