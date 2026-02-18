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

  if (!emailUser || !emailPass) {
    console.error("❌ EMAIL_USER and EMAIL_PASS are required in .env");
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

      if (!emailHost) {
        console.error("❌ EMAIL_HOST is required for custom SMTP");
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
      });
    }

    console.log(`✅ Email transporter configured: ${service}`);
    return transporter;
  } catch (err) {
    console.error("❌ Failed to create email transporter:", err.message);
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
    return false;
  }

  try {
    await transporter.verify();
    console.log("✅ Email transporter connection verified");
    return true;
  } catch (err) {
    console.warn("⚠️ Email transporter verification failed:", err.message);
    // Don't fail app startup; email is not critical
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

/**
 * Send email with error handling and logging
 * @param {Object} mailOptions - { from, to, subject, html }
 * @returns {Promise<Object|null>} - info object or null if failed
 */
export async function sendEmailSafely(mailOptions) {
  const transporter = getTransporter();

  if (!transporter) {
    console.error("❌ Email transporter not available. Check .env configuration.");
    return null;
  }

  try {
    const info = await new Promise((resolve, reject) => {
      transporter.sendMail(mailOptions, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    console.log(`✅ Email sent to ${mailOptions.to}: ${info.response}`);
    return info;
  } catch (err) {
    console.error(`❌ Failed to send email to ${mailOptions.to}:`, err.message);
    // Return null instead of throwing so callers can handle gracefully
    return null;
  }
}

export default getTransporter();
