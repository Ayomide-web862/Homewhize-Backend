import db from "../config/db.js";

export const createBooking = (booking) => {
  // Calculate business logic
  const accommodationTotal = booking.nights * booking.price_per_night;
  const platformFee = Math.round(accommodationTotal * 0.08 * 100) / 100; // 8% of accommodation only
  const ownerEarnings = accommodationTotal - platformFee;
  const totalAmount = accommodationTotal + booking.caution_fee;
  
  const sql = `
    INSERT INTO bookings
    (property_id, user_id, owner_user_id, full_name, email, phone, check_in, check_out, 
     nights, guests, price_per_night, total_amount, booking_reference, caution_fee, 
     platform_fee_amount, owner_earnings_amount, owner_payout_amount, payment_breakdown_json, 
     caution_fee_status, owner_payout_status, stay_outcome, dispute_status, payout_review_status)
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
    totalAmount,
    booking.booking_reference,
    booking.caution_fee || 0,
    platformFee,
    ownerEarnings,
    ownerEarnings, // owner_payout_amount initially equals owner_earnings_amount
    JSON.stringify({
      accommodation_total: accommodationTotal,
      platform_fee: platformFee,
      owner_earnings: ownerEarnings,
      caution_fee: booking.caution_fee || 0,
      total_paid: totalAmount,
      calculated_at: new Date().toISOString()
    }),
    'held', // caution_fee_status
    'pending', // owner_payout_status
    'pending', // stay_outcome
    'none', // dispute_status
    'awaiting_review' // payout_review_status
  ]);
};

export const getBookingByReference = async (booking_reference) => {
  const [rows] = await db.execute(`
    SELECT *, 
           CAST(payment_breakdown_json AS CHAR) as payment_breakdown_json_str
    FROM bookings 
    WHERE booking_reference = ? LIMIT 1
  `, [booking_reference]);
  
  if (rows && rows.length > 0) {
    const booking = rows[0];
    // Safely parse JSON
    if (booking.payment_breakdown_json_str) {
      try {
        booking.payment_breakdown_json = JSON.parse(booking.payment_breakdown_json_str);
      } catch (e) {
        booking.payment_breakdown_json = {};
      }
    } else {
      booking.payment_breakdown_json = {};
    }
    return booking;
  }
  return null;
};

export const getBookingById = async (id) => {
  const [rows] = await db.execute(`
    SELECT *, 
           CAST(payment_breakdown_json AS CHAR) as payment_breakdown_json_str
    FROM bookings 
    WHERE id = ? LIMIT 1
  `, [id]);
  
  if (rows && rows.length > 0) {
    const booking = rows[0];
    // Safely parse JSON
    if (booking.payment_breakdown_json_str) {
      try {
        booking.payment_breakdown_json = JSON.parse(booking.payment_breakdown_json_str);
      } catch (e) {
        booking.payment_breakdown_json = {};
      }
    } else {
      booking.payment_breakdown_json = {};
    }
    return booking;
  }
  return null;
};

export const updateBookingPaymentStatus = async (booking_reference, payment_status = 'paid') => {
  const sql = `UPDATE bookings SET payment_status = ?, status = CASE WHEN ? = 'paid' THEN 'paid' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE booking_reference = ?`;
  await db.execute(sql, [payment_status, payment_status, booking_reference]);
};

export const updateBookingSettlement = async (booking_id, updates) => {
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  const setClauses = keys.map((key) => `${key} = ?`).join(', ');
  const params = keys.map((key) => {
    // Handle JSON fields
    if (key === 'payment_breakdown_json' && typeof updates[key] === 'object') {
      return JSON.stringify(updates[key]);
    }
    return updates[key];
  });
  params.push(booking_id);

  const sql = `UPDATE bookings SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  await db.execute(sql, params);
};