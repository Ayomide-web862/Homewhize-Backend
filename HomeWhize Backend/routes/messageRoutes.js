import express from "express";
import {
  startConversation,
  fetchProviderConversations,
  fetchUserConversations,
  fetchMessages,
  sendMessage
} from "../controllers/messageController.js";

import { protect } from "../middleware/authMiddleware.js";
import rateLimit from "express-rate-limit";
import cors from "cors";

const router = express.Router();

// OPTIONS handlers MUST be defined first, before CORS middleware
const corsHandler = (req, res) => {
  const origin = req.headers.origin || "http://localhost:5173";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Max-Age", "3600");
  res.sendStatus(200);
};

// router.options("/start", corsHandler);
// router.options("/provider", corsHandler);
// router.options("/user", corsHandler);
// router.options("/:conversationId", corsHandler);
// router.options("/send", corsHandler);

// router.options("/start", corsHandler);
// router.options("/provider", corsHandler);
// router.options("/user", corsHandler);
// router.options("/:conversationId", corsHandler);
// router.options("/send", corsHandler);

// Apply CORS middleware to this router with specific configuration
router.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      "https://homewhize.com",
      "https://www.homewhize.com",
      "http://homewhize.com",
      "http://localhost:5173"
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));

// Rate limiter for message sending (more restrictive)
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'development' ? 100 : 10, // 100 messages per minute in dev, 10 in prod
  message: {
    error: "Too many messages sent",
    message: "Please wait before sending another message",
    retry_after: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for conversation creation
const conversationLimiter = rateLimit({
  windowMs: process.env.NODE_ENV === 'development' ? 60 * 1000 : 15 * 60 * 1000, // 1 minute in dev, 15 minutes in prod
  max: process.env.NODE_ENV === 'development' ? 50 : 5, // 50 conversations per minute in dev, 5 per 15 min in prod
  message: {
    error: "Too many conversations created",
    message: "Please wait before creating another conversation",
    retry_after: process.env.NODE_ENV === 'development' ? 60 : 900
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for fetching messages/conversations
const fetchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'development' ? 300 : 30, // 300 requests per minute in dev, 30 in prod
  message: {
    error: "Too many requests",
    message: "Please wait before making another request",
    retry_after: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/start", protect, conversationLimiter, startConversation);
router.get("/provider", protect, fetchLimiter, fetchProviderConversations);
router.get("/user", protect, fetchLimiter, fetchUserConversations);
router.get("/:conversationId", protect, fetchLimiter, fetchMessages);
router.post("/send", protect, messageLimiter, sendMessage);

export default router;