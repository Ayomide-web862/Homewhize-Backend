import express from "express";
import {
  createNewBooking,
  approveOwnerPayout,
  refundCautionFee,
  releaseCautionFeeToOwner,
  cancelBooking,
  getAllBookings,
  getBookingsForSettlement
} from "../controllers/bookingController.js";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET ALL BOOKINGS
 * admin = own-property bookings
 * superadmin/master = all bookings
 */
router.get(
  "/",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  getAllBookings
);

router.get(
  "/settlement",
  protect,
  roleMiddleware("superadmin", "master"),
  getBookingsForSettlement
);

/**
 * CREATE BOOKING
 * only guests/users should create shortlet bookings
 */
router.post(
  "/",
  protect,
  roleMiddleware("user"),
  createNewBooking
);

router.post(
  "/:id/approve-payout",
  protect,
  roleMiddleware("superadmin", "master"),
  approveOwnerPayout
);

router.post(
  "/:id/refund-caution-fee",
  protect,
  roleMiddleware("superadmin", "master"),
  refundCautionFee
);

router.post(
  "/:id/release-caution-fee",
  protect,
  roleMiddleware("superadmin", "master"),
  releaseCautionFeeToOwner
);

router.post(
  "/:id/cancel",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  cancelBooking
);

export default router;