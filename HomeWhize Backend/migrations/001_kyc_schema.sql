-- KYC Requests Table Schema
-- Run this migration to ensure your kyc_requests table has all necessary columns

CREATE TABLE IF NOT EXISTS `kyc_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `address` TEXT NOT NULL,
  `id_document_url` VARCHAR(500) NOT NULL,
  `ownership_document_url` VARCHAR(500) NOT NULL,
  `status` ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_created_at` (`created_at`)
);

-- If the table exists but is missing columns, run these:
-- ALTER TABLE `kyc_requests` ADD COLUMN `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
-- ALTER TABLE `kyc_requests` MODIFY COLUMN `status` ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending';
-- ALTER TABLE `kyc_requests` ADD INDEX `idx_user_id` (`user_id`);
-- ALTER TABLE `kyc_requests` ADD INDEX `idx_status` (`status`);
-- ALTER TABLE `kyc_requests` ADD INDEX `idx_created_at` (`created_at`);
