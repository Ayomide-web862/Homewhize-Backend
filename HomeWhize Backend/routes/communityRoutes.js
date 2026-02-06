import express from "express";
import upload from "../middleware/upload.js";
import { protect } from "../middleware/authMiddleware.js";

import {
  createPost,
  getPosts,
  addComment,
  getComments,
  toggleLike
} from "../controllers/communityController.js";

const router = express.Router();

router.post("/", protect, upload.array("images", 5), createPost);
router.get("/", getPosts);
router.post("/:postId/comments", protect, addComment);
router.get("/:postId/comments", getComments);
router.post("/:postId/like", protect, toggleLike);

export default router;
