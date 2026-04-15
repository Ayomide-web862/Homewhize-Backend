import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

/**
 * Email Transporter Configuration
 * Supports Gmail with App Password, OAuth2, or custom SMTP
 * 
 * Environment Variables Required:
 * - EMAIL_SERVICE: "gmail" | "custom" (default: "gmail")
 * - EMAIL_USER: Sender email address
 * - EMAIL_PASS: App Password (for Gmail) or SMTP password
 * 
 * Optional for custom SMTP:
 * - EMAIL_HOST: SMTP server hostname
 * - EMAIL_PORT: SMTP port (default: 587)
 * - EMAIL_SECURE: Use TLS (true/false, default: false)
 * 
 * Optional for Gmail OAuth2:
 * - GMAIL_CLIENT_ID: OAuth2 Client ID
 * - GMAIL_CLIENT_SECRET: OAuth2 Client Secret
 * - GMAIL_REFRESH_TOKEN: OAuth2 Refresh Token
 */

let transporter = null;

function createTransporter() {
  const service = process.env.EMAIL_SERVICE || "gmail";
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  // Optional explicit from-address (fall back to EMAIL_USER)
  const emailFrom = process.env.EMAIL_FROM || emailUser;

  if (!emailUser || !emailPass) {
    console.error(" EMAIL_USER and EMAIL_PASS are required in .env");
    console.error("For Gmail: Use an App Password (not your regular password)");
    console.error("See: https://support.google.com/accounts/answer/185833");
    return null;
  }

  try {
    if (service === "gmail") {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      });
    } else {
      // Custom SMTP provider
      const emailHost = process.env.EMAIL_HOST;
      const emailPort = parseInt(process.env.EMAIL_PORT || "587", 10);
      const emailSecure = process.env.EMAIL_SECURE === "true";
      const connTimeout = parseInt(process.env.EMAIL_CONN_TIMEOUT || "10000", 10);
      const greetTimeout = parseInt(process.env.EMAIL_GREETING_TIMEOUT || "10000", 10);
      const socketTimeout = parseInt(process.env.EMAIL_SOCKET_TIMEOUT || "20000", 10);
      const enableLogger = process.env.EMAIL_LOGGER === 'true';
      const enableDebug = process.env.EMAIL_DEBUG === 'true';

      if (!emailHost) {
        console.error(" EMAIL_HOST is required for custom SMTP");
        return null;
      }

      transporter = nodemailer.createTransport({
        host: emailHost,
        port: emailPort,
        secure: emailSecure,
        auth: {
          user: emailUser,
          pass: emailPass,
        },
        // Allow tuning of timeouts and debug options via env
        connectionTimeout: connTimeout,
        greetingTimeout: greetTimeout,
        socketTimeout: socketTimeout,
        logger: enableLogger,
        debug: enableDebug,
        // Optional: allow self-signed certs if explicitly enabled in .env
        tls: process.env.EMAIL_ALLOW_SELF_SIGNED === 'true' ? { rejectUnauthorized: false } : undefined,
      });
    }

    console.log(` Email transporter configured: ${service}`);
    return transporter;
  } catch (err) {
    console.error(" Failed to create email transporter:", err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    return null;
  }
}

/**
 * Verify transporter connection (optional, for startup checks)
 */
export async function verifyEmailConnection() {
  if (!transporter) {
    createTransporter();
  }

  if (!transporter) {
    console.error("Email initialization failure - No transporter available (creation failed)");
    return false;
  }

  try {
    await transporter.verify();
    console.log(" Email transporter connection verified");
    return true;
  } catch (err) {
    console.error("Email initialization failure - Transporter verification failed:", err.message);
    console.error("Email initialization failure - Full error:", err);
    if (err.code) console.error("Email initialization failure - Error code:", err.code);
    if (err.response) console.error("Email initialization failure - SMTP response:", err.response);
    if (err && err.code) console.warn('Error code:', err.code);
    if (err && err.response) console.warn('SMTP response:', err.response);
    if (err && err.stack) console.debug(err.stack);
    // Don't fail app startup; email is not critical
    // Attempt fallback strategies for common network issues (only for custom SMTP)
    try {
      if ((process.env.EMAIL_SERVICE || 'gmail') === 'custom') {
        const hostEnv = process.env.EMAIL_HOST;
        const tried = new Set();
        const originalPort = parseInt(process.env.EMAIL_PORT || '587', 10);
        const candidates = [originalPort, 465, 587];

        for (const p of candidates) {
          if (!p || tried.has(p)) continue;
          tried.add(p);
          const secureTry = p === 465;
          console.log(` Trying SMTP fallback ${hostEnv}:${p} secure=${secureTry}`);
          try {
            const t = nodemailer.createTransport({
              host: hostEnv,
              port: p,
              secure: secureTry,
              auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
              },
              connectionTimeout: parseInt(process.env.EMAIL_CONN_TIMEOUT || '10000', 10),
              greetingTimeout: parseInt(process.env.EMAIL_GREETING_TIMEOUT || '10000', 10),
              socketTimeout: parseInt(process.env.EMAIL_SOCKET_TIMEOUT || '20000', 10),
              tls: process.env.EMAIL_ALLOW_SELF_SIGNED === 'true' ? { rejectUnauthorized: false } : undefined,
            });

            // Verify this transporter quickly
            await t.verify();
            // success — replace global transporter and return true
            transporter = t;
            console.log(` Email transporter fallback succeeded: ${hostEnv}:${p} secure=${secureTry}`);
            return true;
          } catch (retryErr) {
            console.warn(`Fallback attempt to ${hostEnv}:${p} failed:`, retryErr && retryErr.message ? retryErr.message : retryErr);
            // continue to next candidate
          }
        }
      }
    } catch (fallbackErr) {
      console.debug('Fallback verification attempts failed or errored:', fallbackErr && fallbackErr.message ? fallbackErr.message : fallbackErr);
    }

    return false;
  }
}

/**
 * Get the email transporter (lazy-loaded on first call)
 */
export function getTransporter() {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
}

// Helper to build default "from" address used across the app
export function getDefaultFrom() {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@localhost";
}

/**
 * Send email with error handling and logging
 * @param {Object} mailOptions - { from, to, subject, html }
 * @returns {Promise<Object|null>} - info object or null if failed
 */
export async function sendEmailSafely(mailOptions) {
  const transporter = getTransporter();

  if (!transporter) {
    console.error(" Email transporter not available. Check .env configuration.");
    return null;
  }

  try {
    const info = await new Promise((resolve, reject) => {
      transporter.sendMail(mailOptions, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    console.log(` Email sent to ${mailOptions.to}: ${info.response}`);
    return info;
  } catch (err) {
    console.error(` Failed to send email to ${mailOptions.to}:`, err.message);
    // Return null instead of throwing so callers can handle gracefully
    return null;
  }
}

export default getTransporter();
