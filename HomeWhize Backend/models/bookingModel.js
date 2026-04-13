import db from "../config/db.js";

export const createBooking = (booking) => {
  const sql = `
    INSERT INTO bookings 
    (property_id, user_id, owner_user_id, full_name, email, phone, check_in, check_out, nights, guests, price_per_night, total_amount, booking_reference, caution_fee, platform_fee_amount, owner_earnings_amount, owner_payout_amount, payment_breakdown_json, caution_fee_status, owner_payout_status, stay_outcome, caution_fee_refund_reference, owner_transfer_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return db.execute(sql, [
    booking.property_id,
    booking.user_id,
    booking.owner_user_id || null,
    booking.full_name,
    booking.email,
    booking.phone,
    booking.check_in,
    booking.check_out,
    booking.nights,
    booking.guests,
    booking.price_per_night,
    booking.total_amount,
    booking.booking_reference,
    booking.caution_fee || 0,
    booking.platform_fee_amount || 0,
    booking.owner_earnings_amount || 0,
    booking.owner_payout_amount || booking.owner_earnings_amount || 0,
    JSON.stringify(booking.payment_breakdown_json || {}),
    booking.caution_fee_status || 'held',
    booking.owner_payout_status || 'pending',
    booking.stay_outcome || 'pending',
    booking.caution_fee_refund_reference || null,
    booking.owner_transfer_reference || null
  ]);
};

export const getBookingByReference = async (booking_reference) => {
  const [rows] = await db.execute(`SELECT * FROM bookings WHERE booking_reference = ? LIMIT 1`, [booking_reference]);
  return rows && rows.length > 0 ? rows[0] : null;
};

export const getBookingById = async (id) => {
  const [rows] = await db.execute(`SELECT * FROM bookings WHERE id = ? LIMIT 1`, [id]);
  return rows && rows.length > 0 ? rows[0] : null;
};

export const updateBookingPaymentStatus = async (booking_reference, payment_status = 'paid') => {
  const sql = `UPDATE bookings SET payment_status = ?, status = CASE WHEN ? = 'paid' THEN 'paid' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE booking_reference = ?`;
  await db.execute(sql, [payment_status, payment_status, booking_reference]);
};

export const updateBookingSettlement = async (booking_id, updates) => {
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  const setClauses = keys.map((key) => `${key} = ?`).join(', ');
  const params = keys.map((key) => updates[key]);
  params.push(booking_id);

  const sql = `UPDATE bookings SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  await db.execute(sql, params);
};
