import express from "express";
import upload from "../middleware/kycUpload.js";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";

import {
  submitKYC,
  getMyKYCStatus,
  getAllKYC,
  updateKYCStatus,
  downloadDocument,
  viewDocument,
  debugGetKYC,
  getSignedDocumentUrl,
  getBanksList
} from "../controllers/kycController.js";

const router = express.Router();

router.post(
  "/submit",
  protect,
  roleMiddleware("admin", "cleaner"),
  upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "ownershipDocument", maxCount: 1 }
  ]),
  submitKYC
);

router.get("/my-status", protect, getMyKYCStatus);
router.get("/all", protect, roleMiddleware("superadmin"), getAllKYC);
router.put("/:id/status", protect, roleMiddleware("superadmin"), updateKYCStatus);

// Bank list endpoint for frontend dropdown
router.get("/banks", protect, getBanksList);

// Debug endpoints
router.get("/debug/:id", protect, roleMiddleware("superadmin"), debugGetKYC);

// Download document proxy (anyone authenticated can download their own or assigned documents)
router.get("/download/:id/:docType", protect, downloadDocument);
router.get("/document/:id/:docType", protect, viewDocument);

// Legacy endpoint retained for clients that need the original Cloudinary URL.
router.get("/signed-url/:id/:docType", protect, roleMiddleware("superadmin", "master"), getSignedDocumentUrl);

export default router;
