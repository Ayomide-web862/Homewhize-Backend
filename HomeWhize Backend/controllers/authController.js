import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { createUser, findUserByEmail, updatePasswordById } from "../models/userModel.js";

dotenv.config();

// Allowed roles
const allowedRoles = ["user", "admin", "superadmin", "master"];

// Email Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const registerUser = (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const assignedRole = allowedRoles.includes(role) ? role : "user";

    findUserByEmail(email, (err, result) => {
      if (err) return res.status(500).json({ message: "Database error" });

      if (result.length > 0)
        return res.status(400).json({ message: "Email already registered" });

      bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err)
          return res.status(500).json({ message: "Error hashing password" });
        // Ensure we pass the `provider` argument and handle DB errors in callback
        createUser(name, email, hashedPassword, assignedRole, "local", (createErr, result) => {
          if (createErr) {
            console.error("Create user error:", createErr);
            return res.status(500).json({ message: "Failed to create user" });
          }

          return res.status(201).json({
            message: "User registered successfully",
            role: assignedRole,
          });
        });
      });
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const loginUser = (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    findUserByEmail(email, (err, result) => {
      if (err) return res.status(500).json({ message: "Database error" });

      if (result.length === 0)
        return res.status(400).json({ message: "Invalid email or password" });

      const user = result[0];

      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) return res.status(500).json({ message: "Error comparing passwords" });

        if (!isMatch)
          return res.status(400).json({ message: "Invalid email or password" });

        const token = jwt.sign(
          {
            id: user.id,
            name: user.name,
            role: user.role,
            email: user.email
          },
          process.env.JWT_SECRET,
          {
            expiresIn: "2h",              // Reduced from 12h for better security
            issuer: "homewhize-backend",  // Identify your server
            audience: "homewhize-frontend"
          }
        );


        return res.status(200).json({
          message: "Login successful",
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        });
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Return current authenticated user
export const getCurrentUser = (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    return res.status(200).json({ user: req.user });
  } catch (error) {
    console.error("Get current user error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Change password - requires currentPassword and newPassword in body
export const changePassword = (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: "Both current and new passwords are required" });
    if (newPassword.length < 8)
      return res.status(400).json({ message: "New password must be at least 8 characters" });

    // fetch user
    findUserByEmail(req.user.email, (err, rows) => {
      if (err) {
        console.error("Change password - DB error:", err);
        return res.status(500).json({ message: "Database error" });
      }

      if (!rows || rows.length === 0) return res.status(404).json({ message: "User not found" });

      const user = rows[0];

      // verify current password
      bcrypt.compare(currentPassword, user.password, (cmpErr, isMatch) => {
        if (cmpErr) {
          console.error("Change password - compare error:", cmpErr);
          return res.status(500).json({ message: "Server error" });
        }

        if (!isMatch) return res.status(400).json({ message: "Current password is incorrect" });

        // hash new password
        bcrypt.hash(newPassword, 10, (hashErr, hashed) => {
          if (hashErr) {
            console.error("Change password - hash error:", hashErr);
            return res.status(500).json({ message: "Server error" });
          }

          // update
          updatePasswordById(userId, hashed, (upErr, result) => {
            if (upErr) {
              console.error("Change password - update error:", upErr);
              return res.status(500).json({ message: "Failed to update password" });
            }

            return res.status(200).json({ message: "Password updated successfully" });
          });
        });
      });
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
