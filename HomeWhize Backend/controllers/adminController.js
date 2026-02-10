import bcrypt from "bcryptjs";
import {
  createUser,
  findUserByEmail,
  getUsersByRole,
} from "../models/userModel.js";

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
 * GET ALL ADMINS
 */
export const getAllAdmins = (req, res) => {
  getUsersByRole("admin", (err, result) => {
    if (err)
      return res.status(500).json({ message: "Database error" });

    res.status(200).json(result);
  });
};
