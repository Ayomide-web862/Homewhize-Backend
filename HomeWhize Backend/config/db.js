import mysql from "mysql2";
import dotenv from "dotenv";
dotenv.config();

// Build pool configuration with optional SSL
const poolConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONN_LIMIT || "10", 10),
  queueLimit: 0,
  connectTimeout: 20000,
};

// Add SSL only if explicitly required (for remote MySQL on some hosting)
// For cPanel MySQL on same/internal server, SSL is typically NOT needed
if (process.env.DB_SSL === "true") {
  poolConfig.ssl = "Amazon RDS"; // or true for standard SSL
}

const pool = mysql.createPool(poolConfig);

pool.getConnection((err, connection) => {
  if (err) {
    console.error("MySQL connection error:", err);
  } else {
    console.log("MySQL pool connected");
    connection.release();
  }
});

// Export an object that supports both callback-style `query` and
// promise-style `execute` used across the codebase.
const promisePool = pool.promise();

const db = {
  query: (...args) => pool.query(...args),
  execute: (...args) => promisePool.execute(...args),
  getConnection: (...args) => pool.getConnection(...args),
  // Close the underlying pool (useful for graceful shutdown)
  closePool: () => new Promise((resolve, reject) => {
    pool.end((err) => {
      if (err) return reject(err);
      resolve();
    });
  })
};

export default db;
