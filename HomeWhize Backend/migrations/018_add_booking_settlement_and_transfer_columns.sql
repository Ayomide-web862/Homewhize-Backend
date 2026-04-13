-- Add settlement, payout, and booking snapshot support for shortlet bookings

ALTER TABLE bookings
  ADD COLUMN owner_user_id INT NULL,
  ADD COLUMN platform_fee_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN owner_earnings_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN owner_payout_amount DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN payment_breakdown_json JSON NULL,
  ADD COLUMN caution_fee_status ENUM('held','released','refunded') DEFAULT 'held',
  ADD COLUMN owner_payout_status ENUM('pending','paid','failed') DEFAULT 'pending',
  ADD COLUMN stay_outcome ENUM('pending','completed','cancelled') DEFAULT 'pending',
  ADD COLUMN caution_fee_refund_reference VARCHAR(255) NULL,
  ADD COLUMN owner_transfer_reference VARCHAR(255) NULL;

ALTER TABLE transactions
  ADD COLUMN booking_snapshot_json JSON NULL AFTER paystack_payload;

ALTER TABLE subaccounts
  ADD COLUMN transfer_recipient_code VARCHAR(255) NULL AFTER account_number;
