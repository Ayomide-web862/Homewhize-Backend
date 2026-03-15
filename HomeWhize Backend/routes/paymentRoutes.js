import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { initializePayment, verifyPayment, listTransactionsHandler, paymentCallback } from "../controllers/paymentController.js";

const router = express.Router();

// Protected initialize - user must be authenticated
router.post("/initialize", protect, initializePayment);

// Verify (can be called by frontend after redirect)
router.get("/verify/:reference", verifyPayment);

// Callback route (Paystack redirect)
router.get("/callback", paymentCallback);

// Webhook is mounted in server.js with raw body parser for signature verification

// Admin: list transactions
router.get("/transactions", protect, listTransactionsHandler);

export default router;
