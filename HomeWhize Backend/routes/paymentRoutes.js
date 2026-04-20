import express from "express";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";
import {
  initializePayment,
  initializeBookingPayment,
  verifyPayment,
  listTransactionsHandler,
  paymentCallback
} from "../controllers/paymentController.js";

const router = express.Router();

router.post("/initialize", protect, initializePayment);
router.post("/initialize-booking", protect, roleMiddleware("user"), initializeBookingPayment);
router.get("/verify/:reference", verifyPayment);
router.get("/callback", paymentCallback);

router.get(
  "/transactions",
  protect,
  roleMiddleware("superadmin", "master"),
  listTransactionsHandler
);

export default router;