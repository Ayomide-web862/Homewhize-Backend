import crypto from "crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { findUserByEmail, saveOTP, verifyOTP, updatePasswordById, clearOTP } from "../models/userModel.js";
import dotenv from "dotenv";
dotenv.config();

// Email Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Request OTP for password reset
export const requestOTP = (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  findUserByEmail(email, (err, result) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (result.length === 0)
      return res.status(400).json({ message: "Email not found" });

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 60000); // 1 minute expiry

    saveOTP(result[0].id, otp, otpExpiry, (saveErr) => {
      if (saveErr) return res.status(500).json({ message: "Failed to save OTP" });

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Your Password Reset OTP",
        html: `
          <div style="font-family: 'Poppins', sans-serif; max-width: 500px; margin: 0 auto;">
            <div style="background-color: #0F4D3C; padding: 20px; border-radius: 10px; text-align: center;">
              <h1 style="color: white; margin: 0;">HomeWhize</h1>
            </div>
            <div style="padding: 30px; background-color: #F6EEE2; border-radius: 10px; margin-top: 10px;">
              <h2 style="color: #0F4D3C; text-align: center;">Password Reset Request</h2>
              <p style="color: #546C5F; text-align: center; font-size: 16px;">
                Hi ${result[0].name},
              </p>
              <p style="color: #546C5F; text-align: center; font-size: 14px;">
                You requested a password reset. Use the OTP below to verify your identity:
              </p>
              <div style="background-color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border: 2px solid #0F4D3C;">
                <h1 style="color: #0F4D3C; letter-spacing: 5px; margin: 0; font-size: 32px;">${otp}</h1>
              </div>
              <p style="color: #546C5F; text-align: center; font-size: 13px;">
                This OTP is valid for <strong>1 minute</strong> only.
              </p>
              <p style="color: #546C5F; text-align: center; font-size: 13px;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </div>
          </div>
        `,
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if (err) return res.status(500).json({ message: "Email sending failed" });
        res.status(200).json({ message: "OTP sent to your email", email: email });
      });
    });
  });
};

// Verify OTP
export const verifyOTPCode = (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp)
    return res.status(400).json({ message: "Email and OTP are required" });

  findUserByEmail(email, (err, result) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (result.length === 0)
      return res.status(400).json({ message: "Email not found" });

    const userId = result[0].id;

    verifyOTP(userId, otp, (verifyErr, isValid) => {
      if (verifyErr) return res.status(500).json({ message: "Verification failed" });
      if (!isValid)
        return res.status(400).json({ message: "Invalid or expired OTP" });

      // Generate a temporary token for password reset (valid for 15 minutes)
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");
      const resetTokenExpiry = new Date(Date.now() + 900000); // 15 minutes

      // Save temporary reset token
      saveOTP(userId, resetTokenHash, resetTokenExpiry, (saveErr) => {
        if (saveErr)
          return res.status(500).json({ message: "Failed to save reset token" });
        res.status(200).json({
          message: "OTP verified successfully",
          resetToken: resetToken,
        });
      });
    });
  });
};

// Reset password with verified OTP
export const resetPasswordWithToken = (req, res) => {
  const { email, resetToken, newPassword } = req.body;

  if (!email || !resetToken || !newPassword)
    return res.status(400).json({ message: "All fields are required" });

  if (newPassword.length < 8)
    return res.status(400).json({ message: "Password must be at least 8 characters" });

  findUserByEmail(email, (err, result) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (result.length === 0)
      return res.status(400).json({ message: "Email not found" });

    const user = result[0];

    bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
      if (hashErr) return res.status(500).json({ message: "Error processing password" });

      updatePasswordById(user.id, hashedPassword, (updateErr) => {
        if (updateErr)
          return res.status(500).json({ message: "Failed to update password" });

        // Clear OTP after successful reset
        clearOTP(user.id, (clearErr) => {
          if (!clearErr) {
            return res.status(200).json({
              message: "Password reset successfully",
            });
          }
          return res.status(200).json({
            message: "Password reset successfully",
          });
        });
      });
    });
  });
};
