import express from "express";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";
import {
  submitServiceBookingRequest,
  getMyServiceBookings,
  getProviderServiceBookings,
  getServiceBookingDetails,
  acceptServiceBooking,
  rejectServiceBooking,
  cancelServiceBooking,
  markServiceBookingInProgress,
  markServiceBookingCompleted,
  initializeServiceBookingPayment,
  getProviderDashboardStats,
} from "../controllers/serviceBookingController.js";

const router = express.Router();

router.post("/", protect, submitServiceBookingRequest);
router.get("/my", protect, getMyServiceBookings);
router.get("/provider", protect, roleMiddleware("cleaner", "admin", "superadmin", "master"), getProviderServiceBookings);
router.get("/:id", protect, getServiceBookingDetails);
router.post("/:id/accept", protect, roleMiddleware("cleaner", "admin", "superadmin", "master"), acceptServiceBooking);
router.post("/:id/reject", protect, roleMiddleware("cleaner", "admin", "superadmin", "master"), rejectServiceBooking);
router.post("/:id/cancel", protect, cancelServiceBooking);
router.post("/:id/in-progress", protect, roleMiddleware("cleaner", "admin", "superadmin", "master"), markServiceBookingInProgress);
router.post("/:id/complete", protect, roleMiddleware("cleaner", "admin", "superadmin", "master"), markServiceBookingCompleted);
router.post("/:id/pay", protect, initializeServiceBookingPayment);
router.get("/provider/stats", protect, roleMiddleware("cleaner", "admin", "superadmin", "master"), getProviderDashboardStats);

export default router;
