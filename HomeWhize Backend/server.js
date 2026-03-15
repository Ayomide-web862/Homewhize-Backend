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
// chatRoutes removed
import paymentRoutes from "./routes/paymentRoutes.js";
import { paystackWebhook } from "./controllers/paymentController.js";
import providerRoutes from "./routes/providerRoutes.js";
import db from "./config/db.js";
import { verifyEmailConnection } from "./config/emailConfig.js";
import fs from 'fs/promises';

dotenv.config();

// Ensure `fetch` exists in older Node versions by polyfilling with node-fetch if necessary.
// Node 18+ provides global fetch; on older runtimes, prefer installing `node-fetch`.
if (typeof fetch === "undefined") {
  try {
    const { default: fetchPoly } = await import('node-fetch');
    global.fetch = fetchPoly;
    console.log('Polyfilled global.fetch using node-fetch');
  } catch (err) {
    console.warn('Global fetch not available and node-fetch not installed. Please use Node 18+ or install node-fetch.');
  }
}

// Log Paystack secret presence (masked) and whether it's test or live to aid debugging
try {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (key) {
    const kind = /^sk_live_/.test(key) ? 'live' : /^sk_test_/.test(key) ? 'test' : 'unknown';
    console.log(`[PAYSTACK] secret configured (${kind})`);
  } else {
    console.warn('[PAYSTACK] PAYSTACK_SECRET_KEY not set');
  }
} catch (e) {
  // ignore
}

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

// NOTE: Frontend serving via backend removed to allow explicit frontend dev/static hosting.


app.get("/", (req, res) => {
  res.json({
    message: "HomeWhize Backend is running",
    env: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    allowedOrigins: allowedOrigins,
  });
});

// Lightweight health endpoint for external monitors (DB + Email checks)
app.get('/api/health', async (req, res) => {
  const health = { uptime: process.uptime(), timestamp: new Date().toISOString() };
  try {
    // DB check
    try {
      const [rows] = await db.execute('SELECT 1 AS ok');
      health.db = Array.isArray(rows) ? 'ok' : 'unknown';
    } catch (dbe) {
      console.warn('DB health check failed:', dbe.message || dbe);
      health.db = 'error';
      health.dbError = (dbe && dbe.message) ? dbe.message : String(dbe);
    }

    // Email check (non-fatal) - verify connection but do not fail overall if email is not configured
    try {
      const emailOk = await verifyEmailConnection();
      health.email = emailOk ? 'ok' : 'unavailable';
    } catch (ee) {
      console.warn('Email health check failed:', ee && ee.message ? ee.message : ee);
      health.email = 'error';
      health.emailError = (ee && ee.message) ? ee.message : String(ee);
    }

    const statusCode = (health.db === 'ok') ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (err) {
    console.error('Health endpoint error:', err);
    res.status(500).json({ message: 'Health check failed' });
  }
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

// Run SQL migrations in migrations/ directory with a simple tracking table
(async () => {
  try {
    // Ensure migrations table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    // Get already applied
    const [rows] = await db.execute('SELECT filename FROM migrations');
    const applied = new Set((rows || []).map(r => r.filename));

    for (const f of sqlFiles) {
      if (applied.has(f)) {
        console.log('Skipping already-applied migration:', f);
        continue;
      }

      try {
        const content = await fs.readFile(path.join(migrationsDir, f), 'utf8');
        if (content && content.trim()) {
          console.log('Applying migration:', f);
          const parts = content
            .split(';')
            .map(p => p.trim())
            .filter(p => p.length > 0 && !p.startsWith('--'));

          let hadFatal = false;
          for (const stmt of parts) {
            try {
              await db.execute(stmt);
            } catch (stmtErr) {
              // If statement has benign 'already exists' error, ignore; otherwise mark as fatal
              const msg = (stmtErr && stmtErr.message) ? stmtErr.message.toLowerCase() : '';
              if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('errno 1050') ) {
                console.log(`Non-fatal migration message for ${f}:`, stmtErr.message || stmtErr);
                continue;
              }
              console.warn(`Fatal error running statement in ${f}:`, stmtErr.message || stmtErr);
              hadFatal = true;
              break;
            }
          }

          if (!hadFatal) {
            try {
              await db.execute('INSERT INTO migrations (filename) VALUES (?)', [f]);
              console.log('Recorded migration:', f);
            } catch (recErr) {
              console.warn('Could not record migration', f, recErr.message || recErr);
            }
          } else {
            console.warn('Migration not recorded due to fatal error:', f);
          }
        }
      } catch (mfErr) {
        console.warn('Could not apply migration', f, mfErr.message || mfErr);
      }
    }
  } catch (err) {
    console.warn('Migration runner error:', err.message || err);
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
// conversations/chat routes removed
// Mount payments routes
app.use("/api/payments", paymentRoutes);

// Dedicated webhook endpoint: use raw body parser so we can verify Paystack HMAC signature
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paystackWebhook
);
app.use("/api/providers", providerRoutes);
// Providers API removed per request
// serviceBookingRoutes removed



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
let server = null;
if (process.env.PASSENGER_APP === "true" || process.env.PASSENGER === "true") {
  console.log("Passenger mode detected - exporting app for Passenger / cPanel startup");
} else {
  server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  try {
    if (server) {
      server.close(() => console.log('HTTP server closed'));
    }
    // Close DB pool
    try {
      await db.closePool();
      console.log('MySQL pool closed');
    } catch (dberr) {
      console.warn('Error closing DB pool:', dberr && dberr.message ? dberr.message : dberr);
    }
    // Allow some time for pending requests/logs
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Socket.io: initialize if server available
try {
  if (server) {
    const { Server } = await import('socket.io');
    const io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET','POST']
      }
    });

    // Basic Socket.io handlers
    io.on('connection', (socket) => {
      console.log('Socket connected', socket.id);

      // Join conversation room
      socket.on('join', ({ conversationId }) => {
        if (conversationId) socket.join(`conv_${conversationId}`);
      });

      // Provider or user emits message
      socket.on('message', async (payload) => {
        try {
          // payload: { conversationId, senderRole, senderId, text }
          const { conversationId, senderRole, senderId, text } = payload;
          // Persist message
          const { createMessage } = await import('./models/messageModel.js');
          const id = await createMessage(conversationId, senderRole, senderId, text);
          const message = { id, conversationId, senderRole, senderId, text, created_at: new Date() };
          // Broadcast to room
          io.to(`conv_${conversationId}`).emit('message', message);
        } catch (err) {
          console.error('Socket message error', err);
        }
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected', socket.id);
      });
    });
  }
} catch (err) {
  console.warn('Socket.io not initialized:', err && err.message ? err.message : err);
}

// Export the Express app for environments (like Phusion Passenger) that require it.
export default app;
