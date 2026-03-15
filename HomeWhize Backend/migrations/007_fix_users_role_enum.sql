-- Ensure 'cleaner' value exists in users.role enum
-- This migration uses MODIFY to set the full enum including 'cleaner'
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('user','owner','admin','superadmin','master','cleaner') NOT NULL DEFAULT 'user';
