import express from "express";
import upload from "../middleware/upload.js";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";
import {
  deleteProperty,
  getPublicPropertyBySlug,
  addProperty,
  updateProperty,
  getProperties,
  getAllPropertiesForSuperAdmin,
  getPublicProperties,
  getPublicPropertiesCount,
  getPropertyAvailability
} from "../controllers/propertyController.js";

const router = express.Router();

router.post(
  "/",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  upload.fields([{ name: "images", maxCount: 10 }, { name: "images[]", maxCount: 10 }]),
  addProperty
);

router.get(
  "/admin",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  getProperties
);

router.get(
  "/superadmin/all",
  protect,
  roleMiddleware("superadmin", "master"),
  getAllPropertiesForSuperAdmin
);

router.put(
  "/:id",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  updateProperty
);

router.delete(
  "/:id",
  protect,
  roleMiddleware("admin", "superadmin", "master"),
  deleteProperty
);

router.get("/public/slug/:slug", getPublicPropertyBySlug);
router.get("/public/count", getPublicPropertiesCount);
router.get("/public", getPublicProperties);
router.get("/:id/availability", getPropertyAvailability);

export default router;