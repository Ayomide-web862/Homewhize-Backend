import express from "express";
import { createNewBooking } from "../controllers/bookingController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * CREATE BOOKING (AUTH REQUIRED)
 */
router.post("/", protect, createNewBooking);

export default router;
