import db from './config/db.js';

(async () => {
  try {
    const [rows] = await db.execute("SHOW TABLES LIKE 'booked_dates'");
    console.log('booked_dates exists:', rows.length > 0);

    const sql = `SELECT p.id, p.name, EXISTS(SELECT 1 FROM bookings b WHERE b.property_id = p.id AND b.payment_status = 'paid' AND CURDATE() >= b.check_in AND CURDATE() < b.check_out) AS is_currently_occupied, (SELECT GROUP_CONCAT(DISTINCT bd.booked_date) FROM booked_dates bd WHERE bd.property_id = p.id AND bd.booked_date >= CURDATE() ORDER BY bd.booked_date) AS booked_dates FROM properties p WHERE LOWER(p.status) = 'available' LIMIT 1`;

    try {
      const [prows] = await db.query(sql);
      console.log('properties test row', prows[0] || null);
    } catch (e) {
      console.error('properties query error', e.message);
    }
  } catch (e) {
    console.error('db check error', e.message);
  } finally {
    process.exit(0);
  }
})();