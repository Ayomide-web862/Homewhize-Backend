import express from "express";
import { protect, roleMiddleware } from "../middleware/authMiddleware.js";

import {
  createAdmin,
  getAllAdmins,
  createOwner,
  updateAdmin,
  deleteAdmin,
} from "../controllers/adminController.js";

const router = express.Router();

router.post(
  "/create-admin",
  protect,
  roleMiddleware("superadmin", "master"),
  createAdmin
);

router.post(
  "/create-owner",
  protect,
  roleMiddleware("superadmin", "master", "admin"),
  createOwner
);

router.get(
  "/admins",
  protect,
  roleMiddleware("superadmin", "master"),
  getAllAdmins
);

router.put(
  "/update-admin/:id",
  protect,
  roleMiddleware("superadmin", "master"),
  updateAdmin
);

router.delete(
  "/delete-admin/:id",
  protect,
  roleMiddleware("superadmin", "master"),
  deleteAdmin
);

export default router;
