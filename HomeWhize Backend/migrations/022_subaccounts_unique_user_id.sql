-- Add unique constraint on user_id in subaccounts table to prevent duplicates

ALTER TABLE subaccounts ADD CONSTRAINT uk_subaccounts_user_id UNIQUE (user_id);