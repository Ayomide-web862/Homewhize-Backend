import express from "express";
import { check, validationResult } from "express-validator";
import { requestOTP, verifyOTPCode, resetPasswordWithToken } from "../controllers/passwordController.js";

const router = express.Router();

const validate = (checks) => async (req, res, next) => {
	await Promise.all(checks.map((c) => c.run(req)));
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
	next();
};

// Request OTP
router.post(
	"/request-otp",
	validate([check("email").isEmail().normalizeEmail()]),
	requestOTP
);

// Verify OTP
router.post(
	"/verify-otp",
	validate([
		check("email").isEmail().normalizeEmail(),
		check("otp").isLength({ min: 6, max: 6 }),
	]),
	verifyOTPCode
);

// Reset password with OTP
router.post(
	"/reset-password",
	validate([
		check("email").isEmail().normalizeEmail(),
		check("resetToken").notEmpty(),
		check("newPassword").isLength({ min: 8 }),
	]),
	resetPasswordWithToken
);

export default router;
