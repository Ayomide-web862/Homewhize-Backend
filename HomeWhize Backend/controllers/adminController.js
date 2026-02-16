import bcrypt from "bcryptjs";
import {
  createUser,
  findUserByEmail,
  getUsersByRole,
  updateUserById,
  deleteUserById,
  findUserById,
} from "../models/userModel.js";
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
