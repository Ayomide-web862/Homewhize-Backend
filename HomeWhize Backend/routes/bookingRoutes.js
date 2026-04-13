import express from "express";
import { createNewBooking, settleBooking, getAllBookings } from "../controllers/bookingController.js";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET ALL BOOKINGS - ADMIN ONLY
 */
router.get("/", protect, getAllBookings);

/**
 * CREATE BOOKING (AUTH REQUIRED)
 */
router.post("/", protect, createNewBooking);

/**
 * SETTLE BOOKING AFTER STAY AND RELEASE FUNDS
 */
router.post("/:id/settle", protect, roleMiddleware("admin", "superadmin", "master"), settleBooking);

export default router;
