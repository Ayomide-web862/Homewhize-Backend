import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  createProviderHandler,
  getProviderHandler,
  listProvidersHandler,
  createServiceForProvider,
  getProviderBySlugHandler,
  getMyProviderHandler,
  deleteProviderHandler,
} from "../controllers/providerController.js";

const router = express.Router();

// Specific routes first to avoid param collisions (/:id would capture 'me' or 'slug')
router.post("/", createProviderHandler);
router.get("/", listProvidersHandler);
router.get("/slug/:slug", getProviderBySlugHandler); // specific slug route
router.get("/me", protect, getMyProviderHandler); // provider for authenticated user
router.get("/:id", getProviderHandler); // generic id route (last)
router.post("/:id/services", protect, createServiceForProvider);
router.delete("/:id", protect, deleteProviderHandler);

export default router;