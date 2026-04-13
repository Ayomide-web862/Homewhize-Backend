import db from "../config/db.js";

export const createTransaction = async ({ reference, booking_reference = null, booking_id = null, amount = 0, currency = 'NGN', customer_email = null, provider_id = null, paystack_payload = null, booking_snapshot_json = null }) => {
  const sql = `INSERT INTO transactions (reference, booking_reference, booking_id, amount, currency, status, customer_email, provider_id, paystack_payload, booking_snapshot_json) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`;
  const [result] = await db.execute(sql, [
    reference,
    booking_reference,
    booking_id,
    amount,
    currency,
    customer_email,
    provider_id,
    JSON.stringify(paystack_payload || {}),
    JSON.stringify(booking_snapshot_json || {})
  ]);
  return { id: result.insertId, reference };
};

export const getTransactionByReference = async (reference) => {
  const [rows] = await db.execute(`SELECT * FROM transactions WHERE reference = ? LIMIT 1`, [reference]);
  return rows && rows.length ? rows[0] : null;
};

export const updateTransactionStatus = async (reference, status, payload = null, booking_id = null) => {
  let sql = `UPDATE transactions SET status = ?, paystack_payload = ?, updated_at = CURRENT_TIMESTAMP`;
  const params = [status, JSON.stringify(payload || {})];

  if (booking_id !== null) {
    sql += `, booking_id = ?`;
    params.push(booking_id);
  }

  sql += ` WHERE reference = ?`;
  params.push(reference);

  await db.execute(sql, params);
};

export const listTransactions = async () => {
  const [rows] = await db.execute(`SELECT * FROM transactions ORDER BY created_at DESC`);
  return rows || [];
};

export default { createTransaction, getTransactionByReference, updateTransactionStatus, listTransactions };

