import express from "express";
import { check, validationResult } from "express-validator";
import { registerUser, loginUser } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
import { getCurrentUser, changePassword } from "../controllers/authController.js";

const router = express.Router();

const validate = (checks) => async (req, res, next) => {
	await Promise.all(checks.map((c) => c.run(req)));
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
	next();
};

router.post(
	"/signup",
	validate([
		check("name").isString().trim().isLength({ min: 2 }),
		check("email").isEmail().normalizeEmail(),
		check("password").isLength({ min: 8 }),
		check("role").optional().isIn(["user", "admin", "superadmin", "master", "cleaner"]),
	]),
	registerUser
);

router.post(
	"/login",
	validate([check("email").isEmail().normalizeEmail(), check("password").isLength({ min: 8 })]),
	loginUser
);

// Get current authenticated user
router.get("/me", protect, getCurrentUser);

// Change password (protected)
router.post(
	"/change-password",
	protect,
	validate([
		check("currentPassword").isLength({ min: 8 }),
		check("newPassword").isLength({ min: 8 })
	]),
	changePassword
);

export default router;
