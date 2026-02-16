import db from "../config/db.js";

const createUser = (name, email, password, role, provider = "local", callback) => {
  const query =
    "INSERT INTO users (name, email, password, role, provider) VALUES (?, ?, ?, ?, ?)";
  db.query(query, [name, email, password, role, provider], callback);
};


const findUserByEmail = (email, callback) => {
  const query = "SELECT * FROM users WHERE email = ?";
  db.query(query, [email], callback);
};

const getUsersByRole = (role, callback) => {
  const query =
    "SELECT id, name, email, role FROM users WHERE role = ?";
  db.query(query, [role], callback);
};

// Save OTP for password reset
const saveOTP = (userId, otp, expireAt, callback) => {
  const query = `UPDATE users SET otp = ?, otp_expire = ? WHERE id = ?`;
  db.query(query, [otp, expireAt, userId], callback);
};

// Verify OTP
const verifyOTP = (userId, otp, callback) => {
  const query = `SELECT otp, otp_expire FROM users WHERE id = ? LIMIT 1`;
  db.query(query, [userId], (err, rows) => {
    if (err) return callback(err, false);
    if (!rows || rows.length === 0) return callback(null, false);

    const user = rows[0];
    const currentTime = new Date().getTime();
    const expireTime = new Date(user.otp_expire).getTime();

    // Check if OTP matches and is not expired
    if (user.otp === otp && currentTime <= expireTime) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  });
};

// Save reset token (for temporary use after OTP verification)
const saveResetToken = (userId, tokenHash, expireAt, callback) => {
  const query = `UPDATE users SET reset_token = ?, reset_token_expire = ? WHERE id = ?`;
  db.query(query, [tokenHash, expireAt, userId], callback);
};

// Find user by reset token hash
const findUserByResetToken = (tokenHash, callback) => {
  const query = `SELECT id, name, email, reset_token_expire FROM users WHERE reset_token = ? LIMIT 1`;
  db.query(query, [tokenHash], callback);
};

// Update user's password and clear reset token
const updatePasswordById = (userId, hashedPassword, callback) => {
  const query = `UPDATE users SET password = ?, reset_token = NULL, reset_token_expire = NULL WHERE id = ?`;
  db.query(query, [hashedPassword, userId], callback);
};

// Clear OTP after reset
const clearOTP = (userId, callback) => {
  const query = `UPDATE users SET otp = NULL, otp_expire = NULL WHERE id = ?`;
  db.query(query, [userId], callback);
};

// Update user details (name, email)
const updateUserById = (userId, name, email, callback) => {
  const query = `UPDATE users SET name = ?, email = ? WHERE id = ?`;
  db.query(query, [name, email, userId], callback);
};

// Delete user by ID
const deleteUserById = (userId, callback) => {
  const query = `DELETE FROM users WHERE id = ?`;
  db.query(query, [userId], callback);
};

// Find user by ID
const findUserById = (userId, callback) => {
  const query = `SELECT id, name, email, role, provider FROM users WHERE id = ?`;
  db.query(query, [userId], callback);
};

export { saveResetToken, findUserByResetToken, updatePasswordById, saveOTP, verifyOTP, clearOTP, updateUserById, deleteUserById, findUserById };

export { createUser, findUserByEmail, getUsersByRole };
