import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/authRoutes.js";
import googleRoutes from "./routes/googleRoutes.js";
import propertyRoutes from "./routes/propertyRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import communityRoutes from "./routes/communityRoutes.js";
import passwordRouter from "./routes/passwordRouter.js";
import kycRoutes from "./routes/kycRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import db from "./config/db.js";

dotenv.config();

const app = express();

// When running behind a proxy (e.g., nginx, Heroku) trust first proxy
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// CORS - allow only known origins, support credentials and preflight
// Allowed origins can be configured via FRONTEND_URLS (comma-separated) in env
const allowedOriginsEnv = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "http://localhost:5173";
const allowedOrigins = allowedOriginsEnv.split(",").map((s) => s.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  })
);

if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not set. Authentication will fail without it.");
}

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit to 10 requests per window per IP for auth routes
  message: { message: "Too many requests from this IP, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});


// Harden HTTP headers (CSP relaxed - adjust for your frontend assets)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://accounts.google.com", "https://apis.google.com"],
        connectSrc: ["'self'", "https://www.googleapis.com"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: ["'self'", "https://accounts.google.com"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  })
);

// Optionally force HTTPS (set FORCE_HTTPS=true in production env)
if (process.env.FORCE_HTTPS === "true") {
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      return next();
    }
    const httpsUrl = `https://${req.headers.host}${req.url}`;
    res.redirect(301, httpsUrl);
  });
}

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);


app.get("/", (req, res) => {
  res.json({
    message: "HomeWhize Backend is running",
    env: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    allowedOrigins: allowedOrigins,
  });
});

console.log("   Backend initialized");
console.log("   Allowed CORS origins:", allowedOrigins);
console.log("   NODE_ENV:", process.env.NODE_ENV || "development");
console.log("   FORCE_HTTPS:", process.env.FORCE_HTTPS || "false");

// Ensure KYC table exists on startup to avoid runtime ER_NO_SUCH_TABLE errors
(async () => {
  try {
    const createKycTable = `
      CREATE TABLE IF NOT EXISTS kyc_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        address TEXT NOT NULL,
        id_document_url VARCHAR(500) NOT NULL,
        ownership_document_url VARCHAR(500) NOT NULL,
        status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      );
    `;

    await db.execute(createKycTable);
    console.log("KYC table ensured (kyc_requests).");
    // Ensure `updated_at` column exists (some older installations may lack it)
    try {
      await db.execute(
        "ALTER TABLE kyc_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
      );
      console.log("KYC table column 'updated_at' ensured.");
    } catch (alterErr) {
      // Some MySQL versions do not support IF NOT EXISTS on ADD COLUMN; attempt an idempotent fallback
      if (alterErr && /syntax|ER_PARSE_ERROR/i.test(alterErr.message || "")) {
        try {
          await db.execute(
            "ALTER TABLE kyc_requests ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
          );
          console.log("KYC table column 'updated_at' added.");
        } catch (secondErr) {
          console.warn("Could not add 'updated_at' column automatically:", secondErr.message || secondErr);
        }
      } else {
        console.warn("Could not ensure 'updated_at' column:", alterErr.message || alterErr);
      }
    }
  } catch (err) {
    console.error("Failed to ensure kyc_requests table:", err);
  }
})();

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/auth", authLimiter, googleRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/community", communityRoutes);
app.use("/api/auth/password", authLimiter, passwordRouter);
app.use("/api/kyc", kycRoutes);
app.use("/api/bookings", bookingRoutes);



// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  res.status(500).json({ message: "Something went wrong on the server." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
