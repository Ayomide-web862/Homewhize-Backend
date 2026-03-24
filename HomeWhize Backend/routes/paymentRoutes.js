import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { initializePayment, initializeBookingPayment, verifyPayment, listTransactionsHandler, paymentCallback } from "../controllers/paymentController.js";

const router = express.Router();

// Protected initialize - user must be authenticated
router.post("/initialize", protect, initializePayment);

// Initialize booking payment (creates booking only on success)
router.post("/initialize-booking", protect, initializeBookingPayment);

// Verify (can be called by frontend after redirect)
router.get("/verify/:reference", verifyPayment);

// Callback route (Paystack redirect)
router.get("/callback", paymentCallback);

// Webhook is mounted in server.js with raw body parser for signature verification

// Admin: list transactions
router.get("/transactions", protect, listTransactionsHandler);

export default router;
