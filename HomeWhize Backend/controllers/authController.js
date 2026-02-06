import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { createUser, findUserByEmail } from "../models/userModel.js";

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

        createUser(name, email, hashedPassword, assignedRole, () => {
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
            expiresIn: "12h",             // Shorter expiration for safety
            issuer: "homewhize-backend",  // Optional, identify your server
            audience: "homewhize-users"
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
