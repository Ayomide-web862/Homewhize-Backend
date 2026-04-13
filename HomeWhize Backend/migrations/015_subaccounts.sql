-- Subaccounts table for Paystack split payments (one per user)

CREATE TABLE IF NOT EXISTS `subaccounts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `subaccount_code` VARCHAR(255) NOT NULL,
  `bank_name` VARCHAR(255),
  `bank_code` VARCHAR(50),
  `account_number` VARCHAR(50),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_subaccounts_user_id` (`user_id`),
  INDEX `idx_subaccount_code` (`subaccount_code`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

-- Ensure existing KYC table has bank_code for reliable subaccount creation
-- Note: If this column already exists, you can safely ignore the error
ALTER TABLE `kyc_requests`
  ADD COLUMN `bank_code` VARCHAR(50) NULL;

-- Add index for fast lookups (execute separately if index already exists)
-- If you get an error about duplicate index, you can safely ignore - it means the index already exists
CREATE INDEX `idx_kyc_user_id` ON `kyc_requests` (`user_id`);
