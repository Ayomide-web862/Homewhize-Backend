import express from "express";
import upload from "../middleware/upload.js";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";
import { deleteProperty } from "../controllers/propertyController.js";
import { getPublicPropertyBySlug } from "../controllers/propertyController.js";

import {
  addProperty,
  getProperties,
  getPublicProperties
} from "../controllers/propertyController.js";

const router = express.Router();

router.post(
  "/",
  protect,
  upload.array("images", 5),
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


export default router;
