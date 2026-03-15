import express from "express";
import upload from "../middleware/upload.js";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";
import {
  deleteProperty,
  getPublicPropertyBySlug,
  addProperty,
  getProperties,
  getPublicProperties,
  getPropertyAvailability
} from "../controllers/propertyController.js";

const router = express.Router();

router.post(
  "/",
  protect,
  // Accept either `images` or `images[]` fields from the frontend.
  // `fields` lets us accept both naming conventions which some clients use
  // when submitting multiple files.
  upload.fields([{ name: "images", maxCount: 10 }, { name: "images[]", maxCount: 10 }]),
  addProperty
);

router.get(
  "/admin",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  getProperties
);

router.delete(
  "/:id",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  deleteProperty
);

// ✅ Specific route MUST come before generic /public route
router.get("/public/slug/:slug", getPublicPropertyBySlug);

router.get("/public", getPublicProperties);

// Availability check for a property: ?check_in=YYYY-MM-DD&check_out=YYYY-MM-DD
router.get("/:id/availability", getPropertyAvailability);


export default router;
