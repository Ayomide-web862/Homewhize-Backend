import db from './config/db.js';

(async () => {
  try {
    const [rows] = await db.execute('SELECT 1 + 1 AS result');
    console.log('DB test query result:', rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('DB connection test failed:', err);
    process.exit(1);
  }
})();
