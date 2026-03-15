import db from "../config/db.js";

export const createBooking = (booking) => {
  const sql = `
    INSERT INTO bookings 
    (property_id, user_id, full_name, email, phone, check_in, check_out, nights, guests, price_per_night, total_amount, booking_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return db.execute(sql, [
    booking.property_id,
    booking.user_id,
    booking.full_name,
    booking.email,
    booking.phone,
    booking.check_in,
    booking.check_out,
    booking.nights,
    booking.guests,
    booking.price_per_night,
    booking.total_amount,
    booking.booking_reference
  ]);
};

export const updateBookingPaymentStatus = async (booking_reference, payment_status = 'paid') => {
  const sql = `UPDATE bookings SET payment_status = ?, status = CASE WHEN ? = 'paid' THEN 'paid' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE booking_reference = ?`;
  await db.execute(sql, [payment_status, payment_status, booking_reference]);
};
