import bcrypt from "bcryptjs";
import {
  createUser,
  findUserByEmail,
  getUsersByRole,
  updateUserById,
  deleteUserById,
  findUserById,
} from "../models/userModel.js";
import db from "../config/db.js";
import { generateSlug } from "../models/providerModel.js";
import { sendWelcomeEmail, sendKYCReminderEmail } from "../utils/emailService.js";

/**
 * CREATE ADMIN ACCOUNT
 * Role is strictly "admin"
 */
export const createAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    findUserByEmail(email, async (err, result) => {
      if (err)
        return res.status(500).json({ message: "Database error" });

      if (result.length > 0)
        return res.status(400).json({ message: "Email already exists" });

      const hashedPassword = await bcrypt.hash(password, 10);

      // Provide explicit provider and handle DB callback errors
      createUser(name, email, hashedPassword, "admin", "local", (err, result) => {
        if (err) {
          console.error("Create admin error:", err);
          return res.status(500).json({ message: "Failed to create admin" });
        }

        // Send welcome email to admin
        sendWelcomeEmail(name, email, password, "admin")
          .then(() => {
            console.log("Welcome email sent to admin:", email);
          })
          .catch((emailErr) => {
            console.warn("Failed to send welcome email:", emailErr);
            // Don't fail the creation if email fails
          });

        return res.status(201).json({
          message: "Admin account created successfully",
        });
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * CREATE OWNER/USER ACCOUNT WITH TEMPORARY PASSWORD
 * This endpoint is used to create user accounts from the admin panel
 * A temporary password is generated and sent to the user
 */
export const createOwner = async (req, res) => {
  try {
    const { name, email, role = "user" } = req.body;

    if (!name || !email)
      return res.status(400).json({ message: "Name and email are required" });

    findUserByEmail(email, async (err, result) => {
      if (err)
        return res.status(500).json({ message: "Database error" });

      if (result.length > 0)
        return res.status(400).json({ message: "Email already exists" });

      // Generate temporary password
      const tempPassword = "Homewhize@2026";
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // Create user with temporary password
      createUser(name, email, hashedPassword, role, "local", (err, result) => {
        if (err) {
          console.error("Create owner error:", err);
          // Detect enum/data truncation errors and give actionable message
          if (err && err.errno === 1265) {
            return res.status(500).json({ message: "Database rejected the role value. Ensure the 'cleaner' role is added to users.role enum (run migrations)." });
          }
          return res.status(500).json({ message: "Failed to create owner account" });
        }

        // Send welcome email with temporary password
        sendWelcomeEmail(name, email, tempPassword, role)
          .then(() => {
            console.log("Welcome email sent to", role + ":", email);
            
            // Send KYC reminder after a short delay
            setTimeout(() => {
              sendKYCReminderEmail(name, email)
                .then(() => {
                  console.log("KYC reminder email sent to:", email);
                })
                .catch((kycErr) => {
                  console.warn("Failed to send KYC reminder email:", kycErr);
                });
            }, 1000);
          })
          .catch((emailErr) => {
            console.warn("Failed to send welcome email:", emailErr);
            // Don't fail the creation if email fails
          });

        return res.status(201).json({
          message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully. Welcome email sent.`,
          userId: result.insertId,
        });
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Create user + provider atomically
export const createProvider = async (req, res) => {
  let connection;
  try {
    const { company_name, email, phone, address, categories = '', role = 'cleaner' } = req.body;

    // Basic server-side validation
    if (!company_name || !email) return res.status(400).json({ message: 'company_name and email are required' });
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRe.test(String(email).toLowerCase())) return res.status(400).json({ message: 'Invalid email format' });

    // Start transaction
    connection = await new Promise((resolve, reject) => db.getConnection((err, conn) => err ? reject(err) : resolve(conn)));
    const connP = connection.promise();
    await connP.beginTransaction();

    // Check email exists
    const [existing] = await connP.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing && existing.length > 0) {
      await connP.rollback();
      connection.release();
      return res.status(400).json({ message: 'Email already exists' });
    }

    const tempPassword = 'Homewhize@2026';
    const hashed = await bcrypt.hash(tempPassword, 10);

    // Create user
    const [userRes] = await connP.execute(
      'INSERT INTO users (name, email, password, role, provider) VALUES (?, ?, ?, ?, ?)',
      [company_name, email, hashed, role, 'local']
    );
    const userId = userRes.insertId;

    // Create provider row (ensure slug uniqueness)
    let slugBase = generateSlug(company_name || 'provider');
    let slug = slugBase;
    let attempts = 0;
    while (attempts < 5) {
      const [existing] = await connP.execute('SELECT id FROM providers WHERE slug = ? LIMIT 1', [slug]);
      if (!existing || existing.length === 0) break;
      slug = `${slugBase}-${Math.floor(1000 + Math.random() * 9000)}`;
      attempts++;
    }

    const [providerRes] = await connP.execute(
      `INSERT INTO providers (company_name, slug, email, phone, address, categories, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [company_name, slug, email, phone || null, address || null, categories || '', userId]
    );
    const providerId = providerRes.insertId;

    // Fetch the created provider to return a consistent object
    const [createdRows] = await connP.execute('SELECT * FROM providers WHERE id = ? LIMIT 1', [providerId]);
    const createdProvider = createdRows && createdRows[0] ? createdRows[0] : null;

    await connP.commit();
    connection.release();

    // Send emails after commit (non-blocking)
    sendWelcomeEmail(company_name, email, tempPassword, role).catch((e) => console.warn('Welcome email failed:', e));
    setTimeout(() => sendKYCReminderEmail(company_name, email).catch(e => console.warn('KYC email failed:', e)), 1000);

    return res.status(201).json({ message: 'Provider and user created', userId, provider: createdProvider });
  } catch (err) {
    try { if (connection) await connection.promise().rollback(); if (connection) connection.release(); } catch (e) {}
    console.error('createProvider atomic error:', err);
    return res.status(500).json({ message: 'Failed to create provider and user', error: err.message });
  }
};

/**
 * GET ALL ADMINS
 */
export const getAllAdmins = (req, res) => {
  getUsersByRole("admin", (err, result) => {
    if (err)
      return res.status(500).json({ message: "Database error" });

    res.status(200).json(result);
  });
};

/**
 * UPDATE ADMIN/USER DETAILS
 * Allows updating name and email of an admin or user
 */
export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;

    if (!id) return res.status(400).json({ message: "User ID is required" });
    if (!name || !email)
      return res.status(400).json({ message: "Name and email are required" });

    // Check if user exists
    findUserById(id, (findErr, users) => {
      if (findErr) return res.status(500).json({ message: "Database error" });
      if (!users || users.length === 0)
        return res.status(404).json({ message: "User not found" });

      const user = users[0];

      // If email is being changed, check if new email already exists
      if (email !== user.email) {
        findUserByEmail(email, (checkErr, existingUsers) => {
          if (checkErr) return res.status(500).json({ message: "Database error" });
          if (existingUsers && existingUsers.length > 0)
            return res.status(400).json({ message: "Email already in use" });

          // Update user
          updateUserById(id, name, email, (updateErr) => {
            if (updateErr) {
              console.error("Update user error:", updateErr);
              return res.status(500).json({ message: "Failed to update user" });
            }
            res.status(200).json({ message: "User updated successfully" });
          });
        });
      } else {
        // Email not changed, just update name
        updateUserById(id, name, email, (updateErr) => {
          if (updateErr) {
            console.error("Update user error:", updateErr);
            return res.status(500).json({ message: "Failed to update user" });
          }
          res.status(200).json({ message: "User updated successfully" });
        });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * DELETE ADMIN/USER
 * Completely removes a user from the database
 */
export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) return res.status(400).json({ message: "User ID is required" });

    // Check if user exists
    findUserById(id, (findErr, users) => {
      if (findErr) return res.status(500).json({ message: "Database error" });
      if (!users || users.length === 0)
        return res.status(404).json({ message: "User not found" });

      // Delete user
      deleteUserById(id, (deleteErr) => {
        if (deleteErr) {
          console.error("Delete user error:", deleteErr);
          return res.status(500).json({ message: "Failed to delete user" });
        }
        res.status(200).json({ message: "User deleted successfully" });
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
