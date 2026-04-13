import db from "../config/db.js";

export const createServiceBooking = async (booking) => {
  const sql = `
    INSERT INTO service_bookings
    (booking_reference, user_id, provider_id, service_id, full_name, email, phone, alternate_phone,
     service_date, service_time, address, notes, property_type, room_count, urgency_level,
     amount, currency, payment_status, booking_status, provider_response_note, paystack_reference,
     paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return db.execute(sql, [
    booking.booking_reference,
    booking.user_id,
    booking.provider_id,
    booking.service_id,
    booking.full_name,
    booking.email,
    booking.phone,
    booking.alternate_phone || null,
    booking.service_date || null,
    booking.service_time || null,
    booking.address || null,
    booking.notes || null,
    booking.property_type || null,
    booking.room_count || null,
    booking.urgency_level || null,
    booking.amount || 0,
    booking.currency || "NGN",
    booking.payment_status || "unpaid",
    booking.booking_status || "pending",
    booking.provider_response_note || null,
    booking.paystack_reference || null,
    booking.paid_at || null,
  ]);
};

export const getServiceBookingById = async (id) => {
  const sql = `
    SELECT
      sb.*,
      s.title AS service_title,
      s.category AS service_category,
      s.estimated_duration AS service_estimated_duration,
      p.company_name AS provider_name,
      p.slug AS provider_slug,
      u.name AS user_name,
      u.email AS user_email
    FROM service_bookings sb
    LEFT JOIN services s ON sb.service_id = s.id
    LEFT JOIN providers p ON sb.provider_id = p.id
    LEFT JOIN users u ON sb.user_id = u.id
    WHERE sb.id = ?
    LIMIT 1
  `;
  const [rows] = await db.execute(sql, [id]);
  return rows && rows.length ? rows[0] : null;
};

export const getServiceBookingByReference = async (reference) => {
  const sql = `
    SELECT
      sb.*,
      s.title AS service_title,
      s.category AS service_category,
      s.estimated_duration AS service_estimated_duration,
      p.company_name AS provider_name,
      p.slug AS provider_slug,
      u.name AS user_name,
      u.email AS user_email
    FROM service_bookings sb
    LEFT JOIN services s ON sb.service_id = s.id
    LEFT JOIN providers p ON sb.provider_id = p.id
    LEFT JOIN users u ON sb.user_id = u.id
    WHERE sb.booking_reference = ?
    LIMIT 1
  `;
  const [rows] = await db.execute(sql, [reference]);
  return rows && rows.length ? rows[0] : null;
};

export const getUserServiceBookings = async (userId) => {
  const sql = `
    SELECT
      sb.*,
      s.title AS service_title,
      s.category AS service_category,
      p.company_name AS provider_name,
      p.slug AS provider_slug
    FROM service_bookings sb
    LEFT JOIN services s ON sb.service_id = s.id
    LEFT JOIN providers p ON sb.provider_id = p.id
    WHERE sb.user_id = ?
    ORDER BY sb.created_at DESC
  `;
  const [rows] = await db.execute(sql, [userId]);
  return rows || [];
};

export const getProviderServiceBookings = async (providerId) => {
  let sql = `
    SELECT
      sb.*,
      s.title AS service_title,
      s.category AS service_category,
      u.name AS user_name,
      u.email AS user_email
    FROM service_bookings sb
    LEFT JOIN services s ON sb.service_id = s.id
    LEFT JOIN users u ON sb.user_id = u.id
  `;

  const params = [];
  if (providerId !== null && providerId !== undefined) {
    sql += ` WHERE sb.provider_id = ?`;
    params.push(providerId);
  }

  sql += ` ORDER BY sb.created_at DESC`;
  const [rows] = await db.execute(sql, params);
  return rows || [];
};

export const updateServiceBookingStatus = async (id, booking_status, provider_response_note = null) => {
  const sql = `
    UPDATE service_bookings
    SET booking_status = ?, provider_response_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;
  await db.execute(sql, [booking_status, provider_response_note, id]);
};

export const updateServiceBookingPaymentStatus = async (booking_reference, payment_status = "paid") => {
  const sql = `
    UPDATE service_bookings
    SET payment_status = ?,
        booking_status = CASE WHEN ? = 'paid' THEN 'confirmed' ELSE booking_status END,
        paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE booking_reference = ?
  `;
  await db.execute(sql, [payment_status, payment_status, payment_status, booking_reference]);
};

export const attachPaystackReferenceToServiceBooking = async (id, paystack_reference) => {
  const sql = `
    UPDATE service_bookings
    SET paystack_reference = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;
  await db.execute(sql, [paystack_reference, id]);
};

export default {
  createServiceBooking,
  getServiceBookingById,
  getServiceBookingByReference,
  getUserServiceBookings,
  getProviderServiceBookings,
  updateServiceBookingStatus,
  updateServiceBookingPaymentStatus,
  attachPaystackReferenceToServiceBooking,
};
