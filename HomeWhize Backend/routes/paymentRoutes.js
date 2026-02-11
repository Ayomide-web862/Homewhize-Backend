import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { initializePayment, verifyPayment } from "../controllers/paymentController.js";

const router = express.Router();

// Public initialize - user must send email and amount
router.post("/initialize", protect, initializePayment);

// Verify (can be called by frontend after redirect)
router.get("/verify/:reference", verifyPayment);

export default router;
