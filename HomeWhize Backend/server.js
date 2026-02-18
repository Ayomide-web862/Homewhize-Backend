import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import compression from "compression";
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
import { verifyEmailConnection } from "./config/emailConfig.js";

dotenv.config();

const app = express();

// ESM __dirname helper
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When running behind a proxy (e.g., nginx, Heroku) trust first proxy
// Make proxy trust configurable for Passenger/nginx setups
app.set("trust proxy", process.env.TRUST_PROXY || 1);

// Hide Express signature header
app.disable("x-powered-by");

// Body parsers with sensible limits for production (prevents large payload abuse)
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || "10mb" }));

//  CSRF Protection: Verify origin/referer on state-changing requests
const verifyCsrf = (req, res, next) => {
  if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    const origin = req.headers.origin || req.headers.referer;
    const host = req.headers.host;
    
    // Allow if origin matches host or if it's internal request
    if (origin && !origin.includes(host) && process.env.NODE_ENV === "production") {
      console.warn(`[CSRF Alert] Request from different origin: ${origin}`);
      // In production, you can reject or log
    }
  }
  next();
};
app.use(verifyCsrf);

// CORS - allow only known origins, support credentials and preflight
// Allowed origins can be configured via FRONTEND_URLS (comma-separated) in env
const allowedOriginsEnv =
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  "https://homewhize.com,http://homewhize.com,http://localhost:5173";

const allowedOrigins = allowedOriginsEnv
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow server-to-server / browser direct hits

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("Blocked by CORS:", origin);
      return callback(null, false); // DO NOT THROW ERROR
    },
    credentials: true,
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
        connectSrc: [
          "'self'",
          "https://api.homewhize.com",
          "https://www.googleapis.com"
        ],
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

// Enable gzip/deflate compression for responses to reduce payload size
app.use(compression());

// Optional: serve a built frontend (upload `dist` to `public/` or set `FRONTEND_DIST_PATH`)
if (process.env.SERVE_FRONTEND === "true") {
  const frontendDist = process.env.FRONTEND_DIST_PATH || path.join(__dirname, "public");
  app.use(express.static(frontendDist));

  // Fallback to index.html for client-side routing, but ignore API routes
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  console.log("Serving frontend from:", frontendDist);
}


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
      // First check if the column exists to avoid noisy ALTER errors
      const [cols] = await db.execute("SHOW COLUMNS FROM kyc_requests LIKE 'updated_at'");
      if (cols && cols.length > 0) {
        console.log("KYC table column 'updated_at' already exists.");
      } else {
        await db.execute(
          "ALTER TABLE kyc_requests ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        );
        console.log("KYC table column 'updated_at' added.");
      }
    } catch (alterErr) {
      // If column already exists (duplicate column) or other benign issue, log and continue
      if (alterErr && /ER_DUP_FIELDNAME|duplicate column name/i.test(alterErr.message || "")) {
        console.log("KYC table column 'updated_at' already exists (caught duplicate column).");
      } else {
        console.warn("Could not ensure 'updated_at' column:", alterErr.message || alterErr);
      }
    }
  } catch (err) {
    console.error("Failed to ensure kyc_requests table:", err);
  }
})();

// Verify email configuration on startup
(async () => {
  try {
    const emailOk = await verifyEmailConnection();
    if (!emailOk) {
      console.warn("⚠️ Email service not fully configured. Emails may fail to send.");
      console.warn("   See EMAIL_SETUP_GUIDE.md for configuration help.");
    }
  } catch (err) {
    console.warn("⚠️ Could not verify email connection:", err.message);
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
import paymentRoutes from "./routes/paymentRoutes.js";
app.use("/api/payments", paymentRoutes);



// Global Error Handler - Production Safe
app.use((err, req, res, next) => {
  const isDevelopment = process.env.NODE_ENV === "development";
  
  // Log error for debugging (server-side only)
  if (isDevelopment) {
    console.error("Server Error:", err);
  } else {
    // In production, log errors but don't expose to client
    console.error("[ERROR]", new Date().toISOString(), err);
  }

  // Don't expose internal details in production
  const message = isDevelopment 
    ? err.message 
    : "Something went wrong on the server. Please try again later.";

  res.status(500).json({ 
    message: message,
    // Only expose error code in production, not details
    ...(isDevelopment && { error: err.stack })
  });
});

const PORT = process.env.PORT || 5000;

// For Phusion Passenger / cPanel deployments we should not always call app.listen()
// Passenger will `require()` this file and expect the app to be exported. To support
// both local and Passenger startup, only call `app.listen` when not running under
// Passenger. Set env `PASSENGER_APP=true` on your cPanel app to disable manual listen.
if (process.env.PASSENGER_APP === "true" || process.env.PASSENGER === "true") {
  // Passenger will `require()` this file and expect the app to be exported
  console.log("Passenger mode detected - exporting app for Passenger / cPanel startup");
} else {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// Export the Express app for environments (like Phusion Passenger) that require it.
export default app;
