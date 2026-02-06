import express from "express";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";

import {
  createAdmin,
  getAllAdmins
} from "../controllers/adminController.js";

const router = express.Router();

router.post(
  "/create-admin",
  protect,
  roleMiddleware("superadmin", "master"),
  createAdmin
);

router.get(
  "/admins",
  protect,
  roleMiddleware("superadmin", "master"),
  getAllAdmins
);

export default router;
