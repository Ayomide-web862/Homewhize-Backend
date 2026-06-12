import express from "express";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";
import upload from "../middleware/upload.js";
import {
  createProviderHandler,
  getProviderHandler,
  listProvidersHandler,
  createServiceForProvider,
  getProviderBySlugHandler,
  getMyProviderHandler,
  deleteServiceForProvider,
  deleteProviderHandler,
} from "../controllers/providerController.js";

const router = express.Router();

// Specific routes first to avoid param collisions (/:id would capture 'me' or 'slug')
router.post("/", protect, roleMiddleware("admin", "superadmin", "master"), createProviderHandler);
router.get("/", listProvidersHandler);
router.get("/slug/:slug", getProviderBySlugHandler); // specific slug route
router.get("/me", protect, getMyProviderHandler); // provider for authenticated user
router.get("/:id", getProviderHandler); // generic id route (last)
router.post("/:id/services", protect, upload.array('images', 5), createServiceForProvider);
router.delete("/:id/services/:serviceId", protect, deleteServiceForProvider);
router.delete("/:id", protect, deleteProviderHandler);

export default router;