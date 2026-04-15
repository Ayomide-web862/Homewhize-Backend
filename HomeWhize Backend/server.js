import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";

import authRoutes from "./routes/authRoutes.js";
import googleRoutes from "./routes/googleRoutes.js";
import propertyRoutes from "./routes/propertyRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import communityRoutes from "./routes/communityRoutes.js";
import passwordRouter from "./routes/passwordRouter.js";
import kycRoutes from "./routes/kycRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import serviceBookingRoutes from "./routes/serviceBookingRoutes.js";
import { paystackWebhook } from "./controllers/paymentController.js";
import providerRoutes from "./routes/providerRoutes.js";
import db from "./config/db.js";
import cache from "./config/cache.js";
import { verifyEmailConnection } from "./config/emailConfig.js";
import fs from 'fs/promises';

// DEBUG: global error handlers
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  if (reason && reason.stack) {
    console.error(reason.stack);
  }
  process.exit(1);
});

dotenv.config({ quiet: true });

// DEBUG: startup diagnostics
console.log('=== HOMEWHIZE BACKEND STARTUP ===');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('PORT:', process.env.PORT || 'not set');
console.log('DB_HOST present:', !!process.env.DB_HOST);
console.log('DB_NAME present:', !!process.env.DB_NAME);
console.log('DB_USER present:', !!process.env.DB_USER);
console.log('JWT_SECRET present:', !!process.env.JWT_SECRET);
console.log('PAYSTACK_SECRET_KEY present:', !!process.env.PAYSTACK_SECRET_KEY);
console.log('EMAIL_USER present:', !!process.env.EMAIL_USER);
console.log('EMAIL_PASS present:', !!process.env.EMAIL_PASS);
console.log('FRONTEND_URLS:', process.env.FRONTEND_URLS || 'not set');
console.log('=== STARTUP DIAGNOSTICS COMPLETE ===');

// Log current environment setup
console.log(`[Startup] NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
if (process.env.NODE_ENV === 'production') {
  console.log('[Startup] Running in PRODUCTION mode');
} else {
  console.log('[Startup] Running in DEVELOPMENT mode');
}

// DEBUG: cache initialization
console.log('Cache initialization will be handled in bootstrap...');

// DEBUG: fetch polyfill - Node 20+ has global fetch, no polyfill needed
console.log('Global fetch available in Node 20+ - no polyfill needed.');

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

// Log CORS configuration on startup
console.log("[CORS] Allowed origins:", allowedOrigins);

// EXPLICIT CORS headers middleware - ensures headers are set even behind proxies
// This runs BEFORE express-cors to ensure compatibility with cPanel proxy setups
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowed = !origin || allowedOrigins.includes(origin);
  
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length,X-JSON-Response');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    if (process.env.DEBUG_CORS === 'true') {
      console.log(`[CORS] Allowed request from origin: ${origin || 'no-origin'}`);
    }
  } else if (origin && process.env.DEBUG_CORS === 'true') {
    console.warn(`[CORS] Origin not in allowlist: ${origin}`);
  }
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    if (isAllowed) {
      res.sendStatus(200);
    } else {
      res.status(403).json({ error: 'CORS not allowed for this origin' });
    }
    return;
  }
  
  next();
});

// CORS configuration - applied globally before any routes
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests without origin (server-to-server, direct hits)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // In development, be more permissive
    if (process.env.NODE_ENV !== 'production') {
      console.warn("[CORS] Warning: Request from unallowed origin:", origin);
      return callback(null, true);
    }

    console.warn("[CORS] Blocked request from origin:", origin);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-JSON-Response'],
  optionsSuccessStatus: 200, // for legacy browser compatibility
  maxAge: 86400, // 24 hours cache for preflight
};

// Enable CORS globally (handles preflight automatically)
app.use(cors(corsOptions));

//message routes
app.use("/api/messages", messageRoutes);


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
          "https://homewhize.com",
          "https://www.homewhize.com",
          "https://www.googleapis.com",
          "https://api.paystack.co",
          "https://cloudinary.com",
          "https://res.cloudinary.com"
        ],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: ["'self'", "https://accounts.google.com", "https://www.youtube.com"],
        mediaSrc: ["'self'", "https://res.cloudinary.com"],
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

// DEBUG: optional request logging middleware
if (process.env.DEBUG_REQUESTS === 'true') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[REQUEST] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
  console.log('Request logging enabled (DEBUG_REQUESTS=true)');
}


app.get("/", (req, res) => {
  res.json({
    message: "HomeWhize Backend is running",
    env: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    allowedOrigins: allowedOrigins,
  });
});

// DEBUG: lightweight health route
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || null,
    hasJwtSecret: !!process.env.JWT_SECRET,
    hasPaystackSecret: !!process.env.PAYSTACK_SECRET_KEY,
    hasEmailUser: !!process.env.EMAIL_USER,
    hasEmailPass: !!process.env.EMAIL_PASS,
    hasDbHost: !!process.env.DB_HOST,
    hasDbName: !!process.env.DB_NAME,
    hasDbUser: !!process.env.DB_USER,
    frontendUrls: process.env.FRONTEND_URLS || null,
    timestamp: new Date().toISOString()
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

// CORS diagnostic endpoint - helps debug CORS issues
app.get('/api/cors-check', (req, res) => {
  const origin = req.headers.origin || 'NO_ORIGIN_HEADER';
  const isAllowed = !req.headers.origin || allowedOrigins.includes(req.headers.origin);
  
  res.json({
    status: 'ok',
    cors: {
      requestOrigin: origin,
      allowedOrigins: allowedOrigins,
      isOriginAllowed: isAllowed,
      responseHeaders: {
        'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
        'Access-Control-Allow-Credentials': res.getHeader('Access-Control-Allow-Credentials'),
        'Access-Control-Allow-Methods': res.getHeader('Access-Control-Allow-Methods'),
      }
    },
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      TRUST_PROXY: process.env.TRUST_PROXY || '1',
    }
  });
});

console.log("   Backend initialized");
console.log("   Allowed CORS origins:", allowedOrigins);
console.log("   NODE_ENV:", process.env.NODE_ENV || "development");
console.log("   FORCE_HTTPS:", process.env.FORCE_HTTPS || "false");

// DEBUG: KYC table initialization
console.log('KYC table initialization will be handled in bootstrap...');

// DEBUG: migrations initialization
console.log('Migrations initialization will be handled in bootstrap...');

// DEBUG: email verification
console.log('Email verification will be handled in bootstrap...');

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
app.use("/api/service-bookings", serviceBookingRoutes);



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

// DEBUG: app listen
console.log(`Attempting to start server on port ${PORT}...`);
// For Phusion Passenger / cPanel deployments we should not always call app.listen()
// Passenger will `require()` this file and expect the app to be exported. To support
// both local and Passenger startup, only call `app.listen` when not running under
// Passenger. Set env `PASSENGER_APP=true` on your cPanel app to disable manual listen.
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

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

// Socket.io: initialization will be handled in bootstrap

// Export the Express app for environments (like Phusion Passenger) that require it.
export default app;

// Initialization functions
async function initCache() {
  try {
    console.log('Starting cache initialization...');
    await cache.init();
    console.log('Cache initialization complete.');
  } catch (err) {
    console.warn('Cache initialization failed, continuing with fallback cache:', err && err.message ? err.message : err);
  }
}

async function ensureKycTable() {
  try {
    console.log('Starting KYC table initialization...');
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
    console.log('KYC table initialization complete.');
  } catch (err) {
    console.error("Failed to ensure kyc_requests table:", err);
  }
}

async function runMigrations() {
  try {
    console.log('Starting migrations initialization...');
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
        // Suppress noisy "already applied" logs unless in debug mode
        if (process.env.DEBUG_MIGRATIONS === 'true') {
          console.log('Skipping already-applied migration:', f);
        }
        continue;
      }

      try {
        const content = await fs.readFile(path.join(migrationsDir, f), 'utf8');
        if (content && content.trim()) {
          if (process.env.DEBUG_MIGRATIONS === 'true') {
            console.log('Applying migration:', f);
          }
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
                if (process.env.DEBUG_MIGRATIONS === 'true') {
                  console.log(`Non-fatal migration message for ${f}:`, stmtErr.message || stmtErr);
                }
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
              if (process.env.DEBUG_MIGRATIONS === 'true') {
                console.log('Recorded migration:', f);
              }
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
    console.log('Migrations initialization complete.');
  } catch (err) {
    console.warn('Migration runner error:', err.message || err);
  }
}

async function verifyEmailStartup() {
  try {
    console.log('Starting email verification...');
    const emailOk = await verifyEmailConnection();
    if (!emailOk) {
      console.warn("⚠️ Email service not fully configured. Emails may fail to send.");
      console.warn("   See EMAIL_SETUP_GUIDE.md for configuration help.");
    }
    console.log('Email verification complete.');
  } catch (err) {
    console.warn("⚠️ Could not verify email connection:", err.message);
  }
}

async function initSocket(server) {
  try {
    console.log('Initializing Socket.io...');
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
    console.log('Socket.io initialized successfully.');
  } catch (err) {
    console.warn('Socket.io initialization failed:', err && err.message ? err.message : err);
  }
}

// Bootstrap function to run all async initializations
async function bootstrap() {
  try {
    await initCache();
    await ensureKycTable();
    await runMigrations();
    await verifyEmailStartup();
    if (server) {
      await initSocket(server);
    }
  } catch (err) {
    console.error('Bootstrap error:', err);
  }
}

// Run bootstrap after module load
bootstrap();
