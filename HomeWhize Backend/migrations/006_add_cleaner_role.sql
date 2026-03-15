-- Add 'cleaner' role value to users.role enum
ALTER TABLE users MODIFY COLUMN `role` ENUM('user','owner','admin','superadmin','master','cleaner') DEFAULT 'user';
