ALTER TABLE bookings
  ADD COLUMN dispute_status ENUM('none','open','under_review','resolved') DEFAULT 'none',
  ADD COLUMN payout_review_status ENUM('awaiting_review','approved','caution_fee_held','completed','cancelled') DEFAULT 'awaiting_review',
  ADD COLUMN payout_reviewed_by INT NULL,
  ADD COLUMN payout_reviewed_at DATETIME NULL,
  ADD COLUMN payout_review_note TEXT NULL,
  ADD COLUMN cancellation_reason TEXT NULL;

CREATE INDEX idx_bookings_dispute_status ON bookings(dispute_status);
CREATE INDEX idx_bookings_payout_review_status ON bookings(payout_review_status);
CREATE INDEX idx_bookings_payout_reviewed_at ON bookings(payout_reviewed_at);