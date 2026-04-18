-- Add bank details and provisioning fields to kyc_requests table for Paystack subaccount automation

ALTER TABLE kyc_requests
  ADD COLUMN bank_name VARCHAR(255) NULL AFTER address,
  ADD COLUMN bank_code VARCHAR(50) NULL AFTER bank_name,
  ADD COLUMN account_number VARCHAR(20) NULL AFTER bank_code,
  ADD COLUMN account_name VARCHAR(255) NULL AFTER account_number,
  ADD COLUMN provisioning_status ENUM('pending','success','failed') DEFAULT 'pending' AFTER account_name,
  ADD COLUMN provisioning_error TEXT NULL AFTER provisioning_status,
  ADD COLUMN provisioned_at DATETIME NULL AFTER provisioning_error;

-- Add index for provisioning_status
CREATE INDEX idx_kyc_provisioning_status ON kyc_requests(provisioning_status);

-- Update existing records to have provisioning_status = 'pending' if NULL
UPDATE kyc_requests SET provisioning_status = 'pending' WHERE provisioning_status IS NULL;