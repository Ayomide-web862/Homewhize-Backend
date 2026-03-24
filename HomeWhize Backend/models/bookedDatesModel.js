import db from "../config/db.js";

export const createBookedDates = async (property_id, booking_id, check_in, check_out) => {
  const dates = [];
  const startDate = new Date(check_in);
  const endDate = new Date(check_out);

  for (let date = new Date(startDate); date < endDate; date.setDate(date.getDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }

  if (dates.length === 0) return;

  const values = dates.map(date => `(${property_id}, ${booking_id}, '${date}')`).join(', ');
  const sql = `INSERT INTO booked_dates (property_id, booking_id, booked_date) VALUES ${values}`;

  return db.execute(sql);
};

export const getBookedDatesForProperty = async (property_id, start_date = null, end_date = null) => {
  let sql = `SELECT booked_date FROM booked_dates WHERE property_id = ?`;
  const params = [property_id];

  if (start_date && end_date) {
    sql += ` AND booked_date BETWEEN ? AND ?`;
    params.push(start_date, end_date);
  }

  const [rows] = await db.execute(sql, params);
  return rows.map(row => row.booked_date);
};

export const isDateRangeAvailable = async (property_id, check_in, check_out) => {
  const sql = `
    SELECT COUNT(*) as count FROM booked_dates
    WHERE property_id = ?
    AND booked_date >= ?
    AND booked_date < ?
  `;
  const [rows] = await db.execute(sql, [property_id, check_in, check_out]);
  return rows[0].count === 0;
};

export const removeBookedDates = async (booking_id) => {
  const sql = `DELETE FROM booked_dates WHERE booking_id = ?`;
  return db.execute(sql, [booking_id]);
};