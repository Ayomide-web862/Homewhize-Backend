import express from "express";
import upload from "../middleware/kycUpload.js";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";

import {
  submitKYC,
  getMyKYCStatus,
  getAllKYC,
  updateKYCStatus
} from "../controllers/kycController.js";

const router = express.Router();

router.post(
  "/submit",
  protect,
  roleMiddleware("admin"),
  upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "ownershipDocument", maxCount: 1 }
  ]),
  submitKYC
);

router.get("/my-status", protect, getMyKYCStatus);
router.get("/all", protect, roleMiddleware("superadmin"), getAllKYC);
router.put("/:id/status", protect, roleMiddleware("superadmin"), updateKYCStatus);

export default router;
