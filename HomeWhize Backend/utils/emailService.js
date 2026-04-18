import { sendEmailSafely, getDefaultFrom } from "../config/emailConfig.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Logo URL Configuration
 * Uses environment variable for flexibility (CDN, domain, Cloudinary, etc.)
 * Defaults to serving from your domain at /Homewhize.png
 * 
 * Set in .env:
 * LOGO_URL=https://homewhize.com/Homewhize.png
 * Or use Cloudinary:
 * LOGO_URL=https://res.cloudinary.com/your-account/image/upload/Homewhize.png
 */
const LOGO_URL = process.env.LOGO_URL || `${process.env.FRONTEND_URL || 'https://homewhize.com'}/Homewhize.png`;

console.log("[Email Service] Using logo URL:", LOGO_URL);

// Helper to render a small inline logo sized relative to surrounding text.
// Use `logoImgInline()` inside template strings where the logo should sit inline with text.
function logoImgInline(src = LOGO_URL, alt = "HomeWhize", sizeEm = 1) {
  return `<img src="${src}" alt="${alt}" style="height:${sizeEm}em; width:auto; display:inline-block; vertical-align:middle; margin:0 6px;" />`;
}

// Shared email header HTML with logo
function getEmailHeader() {
  return `
    <div class="header">
      <img src="${LOGO_URL}" alt="HomeWhize Logo" class="logo" />
    </div>
  `;
}

/**
 * Send signup acknowledgment email
 * @param {Object} user - User object with name and email
 * @param {String} signupMethod - "google" or "manual"
 */
export const sendSignupEmail = async (user, signupMethod = "manual") => {
  try {
    const { name, email } = user;
    
    let subject, html;
    
    if (signupMethod === "google") {
      subject = "Welcome to HomeWhize - Google Signup Confirmation";
      html = getGoogleSignupTemplate(name, email);
    } else {
      subject = "Welcome to HomeWhize - Account Created Successfully";
      html = getManualSignupTemplate(name, email);
    }

    const mailOptions = {
      from: getDefaultFrom(),
      to: email,
      subject: subject,
      html: html,
    };

    const info = await sendEmailSafely(mailOptions);
    if (info) {
      console.log(" Signup email sent successfully to", email);
    } else {
      console.warn(" Signup email failed to send to", email, "but process continues");
    }
    return info;
  } catch (error) {
    console.error(" Error in sendSignupEmail:", error.message);
    return null;
  }
};

/**
 * Send welcome email for newly created admin/owner account
 * @param {String} name - User's name
 * @param {String} email - User's email
 * @param {String} tempPassword - Temporary password
 * @param {String} role - User role (admin or owner)
 */
export const sendWelcomeEmail = async (name, email, tempPassword, role = "owner") => {
  try {
    const subject = `Welcome to HomeWhize - Your ${role.charAt(0).toUpperCase() + role.slice(1)} Account`;
    const html = getWelcomeTemplate(name, email, tempPassword, role);

    const mailOptions = {
      from: getDefaultFrom(),
      to: email,
      subject: subject,
      html: html,
    };

    const info = await sendEmailSafely(mailOptions);
    if (info) {
      console.log(" Welcome email sent successfully to", email);
    } else {
      console.warn(" Welcome email failed to send to", email, "but account creation continues");
    }
    return info;
  } catch (error) {
    console.error(" Error in sendWelcomeEmail:", error.message);
    return null;
  }
};

/**
 * Send password change confirmation email
 * @param {String} name - User's name
 * @param {String} email - User's email
 */
export const sendPasswordChangeEmail = async (name, email) => {
  try {
    const subject = "Password Change Confirmation - HomeWhize";
    const html = getPasswordChangeTemplate(name, email);

    const mailOptions = {
      from: getDefaultFrom(),
      to: email,
      subject: subject,
      html: html,
    };

    const info = await sendEmailSafely(mailOptions);
    if (info) {
      console.log(" Password change email sent successfully to", email);
    } else {
      console.warn(" Password change email failed to send to", email, "but change is confirmed");
    }
    return info;
  } catch (error) {
    console.error(" Error in sendPasswordChangeEmail:", error.message);
    return null;
  }
};

/**
 * Send KYC reminder email
 * @param {String} name - User's name
 * @param {String} email - User's email
 */
export const sendKYCReminderEmail = async (name, email) => {
  try {
    const subject = "Complete Your KYC Verification - HomeWhize";
    const html = getKYCReminderTemplate(name, email);

    const mailOptions = {
      from: getDefaultFrom(),
      to: email,
      subject: subject,
      html: html,
    };

    const info = await sendEmailSafely(mailOptions);
    if (info) {
      console.log("KYC reminder email sent successfully to", email);
    } else {
      console.warn("KYC reminder email failed to send to", email);
    }
    return info;
  } catch (error) {
    console.error("Error in sendKYCReminderEmail:", error.message);
    return null;
  }
};

/**
 * Send booking confirmation email
 * @param {Object} booking - Booking object with all booking details
 */
export const sendBookingConfirmationEmail = async (booking) => {
  try {
    const { full_name, email, booking_reference, property_id, check_in, check_out, nights, guests, price_per_night, total_amount, access_code } = booking;

    // Send guest confirmation email
    await sendGuestBookingConfirmationEmail(booking);

    // Send owner notification email
    await sendOwnerBookingNotificationEmail(booking);

    console.log("Booking confirmation emails sent successfully to guest and owner");
    return true;
  } catch (error) {
    console.error("Error in sendBookingConfirmationEmail:", error.message);
    return null;
  }
};

/**
 * Send guest booking confirmation email
 * @param {Object} booking - Booking object
 */
export const sendGuestBookingConfirmationEmail = async (booking) => {
  try {
    const { full_name, email, booking_reference, check_in, check_out, nights, guests, price_per_night, total_amount, access_code } = booking;

    const subject = `Booking Confirmed - ${booking_reference}`;
    const html = getGuestBookingConfirmationTemplate(booking);

    const mailOptions = {
      from: getDefaultFrom(),
      to: email,
      subject: subject,
      html: html,
    };

    const info = await sendEmailSafely(mailOptions);
    if (info) {
      console.log("Guest booking confirmation email sent successfully to", email);
    } else {
      console.warn("Guest booking confirmation email failed to send to", email);
    }
    return info;
  } catch (error) {
    console.error("Error in sendGuestBookingConfirmationEmail:", error.message);
    return null;
  }
};

/**
 * Send owner booking notification email
 * @param {Object} booking - Booking object
 */
export const sendOwnerBookingNotificationEmail = async (booking) => {
  try {
    // Get property details for owner info
    const api = (await import("../api/axios")).default;
    const { data: property } = await api.get(`/properties/${booking.property_id}`);

    const ownerEmail = property.admin_email;
    const ownerName = property.admin_name || "Property Owner";

    const subject = `New Booking - ${booking.booking_reference}`;
    const html = getOwnerBookingNotificationTemplate(booking, property);

    const mailOptions = {
      from: getDefaultFrom(),
      to: ownerEmail,
      subject: subject,
      html: html,
    };

    const info = await sendEmailSafely(mailOptions);
    if (info) {
      console.log("Owner booking notification email sent successfully to", ownerEmail);
    } else {
      console.warn("Owner booking notification email failed to send to", ownerEmail);
    }
    return info;
  } catch (error) {
    console.error("Error in sendOwnerBookingNotificationEmail:", error.message);
    return null;
  }
};

// Template functions
function getManualSignupTemplate(name, email) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to HomeWhize</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          padding: 40px 20px;
          text-align: center;
        }
        .logo {
          max-width: 220px;
          height: auto;
          display: block;
          margin: 0 auto 15px;
          max-height: 3em;
        }
        .header h1 {
          color: white;
          margin: 0;
          font-size: 32px;
          font-weight: 700;
          display: none;
        }
        .content {
          padding: 40px 30px;
          color: #333;
        }
        .greeting {
          font-size: 18px;
          color: #0F4D3C;
          margin-bottom: 20px;
          font-weight: 600;
        }
        .message {
          color: #555;
          line-height: 1.6;
          margin-bottom: 20px;
          font-size: 14px;
        }
        .features {
          background-color: #F6EEE2;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .features h3 {
          color: #0F4D3C;
          margin-top: 0;
          font-size: 16px;
        }
        .features ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        .features li {
          color: #555;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .cta-button {
          display: inline-block;
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 6px;
          margin: 20px 0;
          font-weight: 600;
          font-size: 14px;
        }
        .footer {
          background-color: #f9f9f9;
          padding: 20px;
          text-align: center;
          color: #888;
          font-size: 12px;
          border-top: 1px solid #eee;
        }
        .footer p {
          margin: 5px 0;
        }
        .highlight {
          color: #0F4D3C;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${LOGO_URL}" alt="HomeWhize Logo" class="logo" />
          <h1>HomeWhize</h1>
        </div>
        
        <div class="content">
          <div class="greeting">Welcome to HomeWhize, ${name}!</div>
          
          <div class="message">
            <p>We're thrilled to have you join our community! Your account has been successfully created, and you're now part of a network dedicated to providing exceptional property rental experiences.</p>
          </div>

          <div class="features">
            <h3>What You Can Do Now:</h3>
            <ul>
              <li><strong>Browse Properties:</strong> Explore our extensive collection of verified properties</li>
              <li><strong>Make Bookings:</strong> Reserve your ideal accommodation with just a few clicks</li>
              <li><strong>Join Community:</strong> Connect with other users and share experiences</li>
              <li><strong>Secure Payments:</strong> Enjoy safe and secure payment transactions</li>
            </ul>
          </div>

          <p class="message" style="margin-top: 30px;">
            <strong style="color: #0F4D3C;">Account Details:</strong><br>
            Email: <span class="highlight">${email}</span><br>
            Account Status: <span class="highlight">Active</span>
          </p>

          <p class="message">
            If you have any questions or need assistance, our support team is here to help. Don't hesitate to reach out!
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://homewhize.com" class="cta-button">Get Started Now</a>
          </div>
        </div>

        <div class="footer">
          <p>&copy; 2026 HomeWhize. All rights reserved.</p>
          <p>You received this email because you signed up for HomeWhize.</p>
          <p>
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Privacy Policy</a> | 
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Terms of Service</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getGoogleSignupTemplate(name, email) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to HomeWhize</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          padding: 40px 20px;
          text-align: center;
        }
        .logo {
          max-width: 220px;
          height: auto;
          display: block;
          margin: 0 auto 15px;
          max-height: 3em;
        }
        .header h1 {
          color: white;
          margin: 0;
          font-size: 32px;
          font-weight: 700;
          display: none;
        }
        .google-badge {
          color: white;
          font-size: 12px;
          margin-top: 10px;
          opacity: 0.9;
        }
        .content {
          padding: 40px 30px;
          color: #333;
        }
        .greeting {
          font-size: 18px;
          color: #0F4D3C;
          margin-bottom: 20px;
          font-weight: 600;
        }
        .message {
          color: #555;
          line-height: 1.6;
          margin-bottom: 20px;
          font-size: 14px;
        }
        .google-connect {
          background: linear-gradient(135deg, #F6EEE2 0%, #faf4ef 100%);
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
          border-left: 4px solid #0F4D3C;
        }
        .google-connect p {
          margin: 0;
          color: #555;
          font-size: 13px;
        }
        .features {
          background-color: #F6EEE2;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .features h3 {
          color: #0F4D3C;
          margin-top: 0;
          font-size: 16px;
        }
        .features ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        .features li {
          color: #555;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .cta-button {
          display: inline-block;
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 6px;
          margin: 20px 0;
          font-weight: 600;
          font-size: 14px;
        }
        .footer {
          background-color: #f9f9f9;
          padding: 20px;
          text-align: center;
          color: #888;
          font-size: 12px;
          border-top: 1px solid #eee;
        }
        .footer p {
          margin: 5px 0;
        }
        .highlight {
          color: #0F4D3C;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${LOGO_URL}" alt="HomeWhize Logo" class="logo" />
          <div class="google-badge">✓ Google Account Connected</div>
        </div>
        
        <div class="content">
          <div class="greeting">Welcome ${name}! </div>
          
          <div class="message">
            <p>Congratulations! Your HomeWhize account has been successfully created using your Google account. You're all set to start exploring amazing properties!</p>
          </div>

          <div class="google-connect">
            <p><strong style="color: #0F4D3C;"> Secure Connection</strong><br>
            Your account is securely connected to your Google account for easy, fast login.</p>
          </div>

          <div class="features">
            <h3>Ready to Explore:</h3>
            <ul>
              <li>✓ Browse premium properties across multiple cities</li>
              <li>✓ Make instant bookings with secure payment</li>
              <li>✓ Join our vibrant community</li>
              <li>✓ Access exclusive deals and offers</li>
            </ul>
          </div>

          <p class="message">
            <strong style="color: #0F4D3C;">Quick Tip:</strong> Complete your profile and consider filling out your KYC verification to unlock premium features and benefits on HomeWhize.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://homewhize.com" class="cta-button">Start Exploring Now</a>
          </div>
        </div>

        <div class="footer">
          <p>&copy; 2026 HomeWhize. All rights reserved.</p>
          <p>Account Email: <span class="highlight">${email}</span></p>
          <p>
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Privacy Policy</a> | 
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Terms of Service</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getWelcomeTemplate(name, email, tempPassword, role) {
  const roleTitle = role.charAt(0).toUpperCase() + role.slice(1);
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to HomeWhize - ${roleTitle} Account</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 700px;
          margin: 0 auto;
          background-color: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          padding: 40px 20px;
          text-align: center;
        }
        .logo {
          max-width: 220px;
          height: auto;
          display: block;
          margin: 0 auto 15px;
          max-height: 3em;
        }
        .header h1 {
          color: white;
          margin: 0;
          font-size: 32px;
          font-weight: 700;
        }
        .role-badge {
          display: inline-block;
          background: rgba(255, 255, 255, 0.2);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          margin-top: 10px;
          font-size: 12px;
          font-weight: 600;
        }
        .content {
          padding: 40px 30px;
          color: #333;
        }
        .greeting {
          font-size: 20px;
          color: #0F4D3C;
          margin-bottom: 15px;
          font-weight: 700;
        }
        .message {
          color: #555;
          line-height: 1.7;
          margin-bottom: 20px;
          font-size: 14px;
        }
        .credentials-box {
          background: linear-gradient(135deg, #F6EEE2 0%, #faf4ef 100%);
          padding: 25px;
          border-radius: 8px;
          margin: 25px 0;
          border-left: 4px solid #E07000;
        }
        .credentials-box h3 {
          color: #0F4D3C;
          margin-top: 0;
          margin-bottom: 15px;
          font-size: 16px;
        }
        .credential-item {
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 1px solid #e0d4c4;
        }
        .credential-item:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }
        .credential-label {
          color: #666;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .credential-value {
          background: white;
          padding: 10px 12px;
          border-radius: 4px;
          margin-top: 5px;
          font-family: 'Courier New', monospace;
          color: #0F4D3C;
          font-weight: 600;
          font-size: 14px;
          word-break: break-all;
          border: 1px solid #ddd;
        }
        .password-warning {
          background: #fff3cd;
          padding: 12px;
          border-radius: 6px;
          margin-top: 12px;
          border-left: 4px solid #E07000;
          font-size: 12px;
          color: #856404;
        }
        .steps-box {
          background-color: #F6EEE2;
          padding: 25px;
          border-radius: 8px;
          margin: 25px 0;
        }
        .steps-box h3 {
          color: #0F4D3C;
          margin-top: 0;
          font-size: 16px;
        }
        .steps-list {
          list-style: none;
          padding: 0;
          margin: 15px 0;
        }
        .steps-list li {
          padding: 12px 0;
          color: #555;
          font-size: 13px;
          border-bottom: 1px solid #e0d4c4;
          display: flex;
          align-items: flex-start;
        }
        .steps-list li:last-child {
          border-bottom: none;
        }
        .step-number {
          background: #0F4D3C;
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 12px;
          font-weight: 700;
          flex-shrink: 0;
          font-size: 12px;
        }
        .step-content {
          flex: 1;
          line-height: 1.6;
        }
        .step-content strong {
          color: #0F4D3C;
        }
        .cta-button {
          display: inline-block;
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          color: white;
          padding: 14px 40px;
          text-decoration: none;
          border-radius: 6px;
          margin: 20px 0;
          font-weight: 600;
          font-size: 14px;
          text-align: center;
        }
        .cta-button:hover {
          opacity: 0.95;
        }
        .support-box {
          background: #f0f8f7;
          padding: 15px;
          border-radius: 6px;
          margin: 20px 0;
          border-left: 4px solid #0F4D3C;
        }
        .support-box p {
          margin: 5px 0;
          font-size: 13px;
          color: #555;
        }
        .support-box strong {
          color: #0F4D3C;
        }
        .footer {
          background-color: #f9f9f9;
          padding: 20px 30px;
          text-align: center;
          color: #888;
          font-size: 12px;
          border-top: 1px solid #eee;
        }
        .footer p {
          margin: 5px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${LOGO_URL}" alt="HomeWhize Logo" class="logo" />
          <h1> HomeWhize</h1>
          <div class="role-badge">${roleTitle} Account Created</div>
        </div>
        
        <div class="content">
          <div class="greeting">Welcome to HomeWhize, ${name}!</div>
          
          <div class="message">
            Your ${role} account has been successfully created! Here's everything you need to get started with your HomeWhize dashboard.
          </div>

          <div class="credentials-box">
            <h3>Your Account Credentials</h3>
            <div class="credential-item">
              <div class="credential-label">Email Address</div>
              <div class="credential-value">${email}</div>
            </div>
            <div class="credential-item">
              <div class="credential-label">Temporary Password</div>
              <div class="credential-value">${tempPassword}</div>
              <div class="password-warning">
                ⚠️ This is a temporary password. Please change it immediately after your first login for security.
              </div>
            </div>
          </div>

          <div class="steps-box">
            <h3> How to Change Your Password</h3>
            <ol class="steps-list">
              <li>
                <div class="step-number">1</div>
                <div class="step-content">
                  <strong>Login to Admin Dashboard</strong><br>
                  Visit the admin panel and log in with your email and temporary password.
                </div>
              </li>
              <li>
                <div class="step-number">2</div>
                <div class="step-content">
                  <strong>Access Settings</strong><br>
                  Click on Settings from the sidebar menu to view your account settings.
                </div>
              </li>
              <li>
                <div class="step-number">3</div>
                <div class="step-content">
                  <strong>Change Password</strong><br>
                  Enter your temporary password, then create a new strong password.
                </div>
              </li>
              <li>
                <div class="step-number">4</div>
                <div class="step-content">
                  <strong>Complete KYC Verification</strong><br>
                  Visit your KYC page and complete the verification process to start managing your properties.
                </div>
              </li>
            </ol>
          </div>

          <div class="support-box">
            <p><strong> Key Steps:</strong></p>
            <p>1. Change your password immediately upon first login</p>
            <p>2. Complete your KYC verification on the KYC page</p>
            <p>3. Start managing your properties and bookings</p>
          </div>

          <div style="text-align: center; back">
            <a href="https://homewhize.com/login" class="cta-button">Access Admin Dashboard style=" #eee;"</a>
          </div>

          <div class="message" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <strong style="color: #0F4D3C;">Need Help?</strong><br>
            If you have any questions or experience any issues, please don't hesitate to contact our support team. We're here to help!
          </div>
        </div>

        <div class="footer">
          <p>&copy; 2026 HomeWhize. All rights reserved.</p>
          <p>You received this email because you were added as a ${role} on HomeWhize.</p>
          <p>
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Privacy Policy</a> | 
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Terms of Service</a> | 
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Contact Support</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getPasswordChangeTemplate(name, email) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Changed - HomeWhize</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          padding: 40px 20px;
          text-align: center;
        }
        .header h1 {
          color: white;
          margin: 0;
          font-size: 32px;
          font-weight: 700;
          display: none;
        }
        .logo {
          max-width: 220px;
          height: auto;
          display: block;
          margin: 0 auto 15px;
          max-height: 3em;
        }
        .success-icon {
          font-size: 60px;
          color: #4CAF50;
          margin-top: 15px;
        }
        .content {
          padding: 40px 30px;
          color: #333;
        }
        .greeting {
          font-size: 18px;
          color: #0F4D3C;
          margin-bottom: 15px;
          font-weight: 600;
          text-align: center;
        }
        .success-message {
          background: linear-gradient(135deg, #e8f5e9 0%, #f1f8f6 100%);
          border-left: 4px solid #4CAF50;
          padding: 20px;
          border-radius: 6px;
          margin: 20px 0;
          text-align: center;
          color: #2e7d32;
        }
        .message {
          color: #555;
          line-height: 1.6;
          margin: 15px 0;
          font-size: 14px;
        }
        .security-tips {
          background-color: #F6EEE2;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .security-tips h3 {
          color: #0F4D3C;
          margin-top: 0;
          font-size: 16px;
        }
        .security-tips ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        .security-tips li {
          color: #555;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .info-box {
          background: #f0f8f7;
          padding: 15px;
          border-radius: 6px;
          margin: 20px 0;
          border-left: 4px solid #0F4D3C;
          font-size: 13px;
          color: #555;
        }
        .footer {
          background-color: #f9f9f9;
          padding: 20px;
          text-align: center;
          color: #888;
          font-size: 12px;
          border-top: 1px solid #eee;
        }
        .footer p {
          margin: 5px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${LOGO_URL}" alt="HomeWhize Logo" class="logo" />
          <div class="success-icon">✓</div>
        </div>
        
        <div class="content">
          <div class="greeting">Password Changed Successfully</div>
          
          <div class="success-message">
            Hi ${name}, your HomeWhize account password has been updated successfully!
          </div>

          <div class="message">
            This is a confirmation that your password was changed on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.
          </div>

          <div class="security-tips">
            <h3> Security Tips:</h3>
            <ul>
              <li><strong>Never share your password</strong> with anyone, including HomeWhize staff</li>
              <li><strong>Use a strong password</strong> that includes uppercase, lowercase, numbers, and symbols</li>
              <li><strong>Change your password regularly</strong> for better security</li>
              <li><strong>Logout</strong> from all devices if you used a device that's not yours</li>
              <li><strong>Monitor your account</strong> activity regularly</li>
            </ul>
          </div>

          <div class="info-box">
            <strong style="color: #0F4D3C;"> Quick Reminder:</strong><br>
            Keep your new password secure and don't share it with anyone. If you didn't make this change, please contact our support team immediately.
          </div>

          <div class="message" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <strong style="color: #0F4D3C;">Any Issues?</strong><br>
            If you didn't authorize this password change, or if you need any assistance, please contact our support team right away.
          </div>
        </div>

        <div class="footer">
          <p>&copy; 2026 HomeWhize. All rights reserved.</p>
          <p>Account Email: <strong>${email}</strong></p>
          <p>
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Privacy Policy</a> | 
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Contact Support</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getKYCReminderTemplate(name, email) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Complete Your KYC Verification - HomeWhize</title>
      <style>
        body {
          font-family: 'Poppins', Arial, sans-serif;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          padding: 40px 20px;
          text-align: center;
        }
        .header h1 {
          color: white;
          margin: 0;
          font-size: 32px;
          font-weight: 700;
          display: none;
        }
        .logo {
          max-width: 220px;
          height: auto;
          display: block;
          margin: 0 auto 15px;
          max-height: 3em;
        }
        .content {
          padding: 40px 30px;
          color: #333;
        }
        .greeting {
          font-size: 18px;
          color: #0F4D3C;
          margin-bottom: 15px;
          font-weight: 600;
        }
        .message {
          color: #555;
          line-height: 1.6;
          margin-bottom: 20px;
          font-size: 14px;
        }
        .kyc-benefits {
          background: linear-gradient(135deg, #F6EEE2 0%, #faf4ef 100%);
          padding: 25px;
          border-radius: 8px;
          margin: 25px 0;
          border-left: 4px solid #0F4D3C;
        }
        .kyc-benefits h3 {
          color: #0F4D3C;
          margin-top: 0;
          font-size: 16px;
        }
        .benefits-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 15px 0;
        }
        .benefit-item {
          background: white;
          padding: 12px;
          border-radius: 6px;
          font-size: 12px;
          color: #555;
          border: 1px solid #e0d4c4;
        }
        .benefit-item strong {
          color: #0F4D3C;
          display: block;
          margin-bottom: 5px;
        }
        .requirement-box {
          background: #f0f8f7;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
          border-left: 4px solid #0F4D3C;
        }
        .requirement-box h3 {
          color: #0F4D3C;
          margin-top: 0;
          font-size: 15px;
        }
        .docs-list {
          margin: 15px 0;
          padding-left: 20px;
        }
        .docs-list li {
          color: #555;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .cta-button {
          display: inline-block;
          background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%);
          color: white;
          padding: 14px 40px;
          text-decoration: none;
          border-radius: 6px;
          margin: 20px 0;
          font-weight: 600;
          font-size: 14px;
          text-align: center;
          width: 80%;
        }
        .footer {
          background-color: #f9f9f9;
          padding: 20px;
          text-align: center;
          color: #888;
          font-size: 12px;
          border-top: 1px solid #eee;
        }
        .footer p {
          margin: 5px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${LOGO_URL}" alt="HomeWhize Logo" class="logo" />
        </div>
        
        <div class="content">
          <div class="greeting">Hi ${name}, </div>
          
          <div class="message">
            We've noticed that your KYC (Know Your Customer) verification is still pending. Completing this verification is essential to unlock the full potential of your HomeWhize account!
          </div>

          <div class="kyc-benefits">
            <h3> What You'll Unlock After KYC:</h3>
            <div class="benefits-grid">
              <div class="benefit-item">
                <strong> Full Payments</strong>
                Enable complete booking transactions
              </div>
              <div class="benefit-item">
                <strong> Analytics</strong>
                Access detailed booking reports
              </div>
              <div class="benefit-item">
                <strong> Premium Badge</strong>
                Build trust with guests
              </div>
              <div class="benefit-item">
                <strong> Exclusive Offers</strong>
                Get special promotions
              </div>
            </div>
          </div>

          <div class="requirement-box">
            <h3> Required Documents:</h3>
            <ul class="docs-list">
              <li><strong>Valid ID Document:</strong> Passport, Driver's License, or National ID</li>
              <li><strong>Proof of Ownership/Occupancy:</strong> Utility bill or property lease</li>
              <li><strong>Personal Information:</strong> Full name, email, phone, and address</li>
            </ul>
            <p style="font-size: 13px; color: #666; margin-top: 15px;">
              All documents must be clear, legible, and recently dated (within last 6 months for utility bills).
            </p>
          </div>

          <div style="text-align: center;">
            <a href="https://homewhize.com/login" class="cta-button">Complete KYC Now</a>
          </div>

          <div class="message" style="margin-top: 30px;">
            <strong style="color: #0F4D3C;"> Friendly Reminder:</strong><br>
            The sooner you complete your KYC verification, the sooner you can start maximizing your earnings and opportunities on HomeWhize. It typically takes only 5-10 minutes!
          </div>

          <div class="message" style="padding-top: 20px; border-top: 1px solid #eee; margin-top: 20px;">
            If you have any questions about the KYC process, our support team is always ready to help!
          </div>
        </div>

        <div class="footer">
          <p>&copy; 2026 HomeWhize. All rights reserved.</p>
          <p>Account Email: <strong>${email}</strong></p>
          <p>
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Privacy Policy</a> | 
            <a href="#" style="color: #0F4D3C; text-decoration: none;">Contact Support</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getBookingConfirmationTemplate(booking) {
  const {
    full_name,
    email,
    booking_reference,
    check_in,
    check_out,
    nights,
    guests,
    price_per_night,
    total_amount,
    caution_fee = 0,
  } = booking;

  const checkInDate = new Date(check_in).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const checkOutDate = new Date(check_out).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const roomTotal = nights * price_per_night;

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Booking Confirmed - HomeWhize</title>
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%); padding: 40px 20px; text-align: center; color: white; }
          .content { padding: 40px 30px; line-height: 1.6; }
          .booking-details { background: #F6EEE2; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #0F4D3C; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #ddd; }
          .detail-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
          .total-row { background: #0F4D3C; color: white; padding: 15px; border-radius: 6px; text-align: center; font-size: 18px; font-weight: bold; margin-top: 15px; }
          .success-message { background: #DFF6EA; color: #0F4D3C; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0; border: 1px solid #0F4D3C; }
          .footer { background: #f8f8f8; padding: 20px 30px; text-align: center; color: #666; font-size: 14px; }
          .reference-highlight { background: #FFF1DB; color: #C27B3E; padding: 10px; border-radius: 4px; display: inline-block; font-weight: bold; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Booking Confirmed!</h1>
            <p>Your shortlet reservation has been successfully processed</p>
          </div>
          <div class="content">
            <div class="success-message">
              🎉 <strong>Congratulations ${full_name}!</strong><br />
              Your booking has been confirmed and payment processed successfully.
            </div>
            <p>Dear ${full_name},</p>
            <p>Thank you for choosing HomeWhize for your accommodation needs. Your booking has been confirmed.</p>
            <div style="text-align:center; margin:20px 0;">
              <span class="reference-highlight">Booking Reference: ${booking_reference}</span>
            </div>
            <div class="booking-details">
              <h3 style="margin-top: 0; color: #0F4D3C;">📅 Booking Details</h3>
              <div class="detail-row"><span><strong>Check-in:</strong></span><span>${checkInDate}</span></div>
              <div class="detail-row"><span><strong>Check-out:</strong></span><span>${checkOutDate}</span></div>
              <div class="detail-row"><span><strong>Duration:</strong></span><span>${nights} night${nights > 1 ? 's' : ''}</span></div>
              <div class="detail-row"><span><strong>Guests:</strong></span><span>${guests} guest${guests > 1 ? 's' : ''}</span></div>
              <div class="detail-row"><span><strong>Price per Night:</strong></span><span>₦${price_per_night.toLocaleString()}</span></div>
              <div class="detail-row"><span><strong>Room Total:</strong></span><span>₦${roomTotal.toLocaleString()}</span></div>
              ${caution_fee > 0 ? `<div class="detail-row"><span><strong>Caution Fee:</strong></span><span>₦${caution_fee.toLocaleString()}</span></div>` : ''}
              <div class="total-row">Total Amount Paid: ₦${total_amount.toLocaleString()}</div>
            </div>
            <p>We wish you a pleasant stay!</p>
            <p>Best regards,<br /><strong>The HomeWhize Team</strong></p>
          </div>
          <div class="footer">
            <p>&copy; 2026 HomeWhize. All rights reserved.</p>
            <p>Booking Reference: <strong>${booking_reference}</strong></p>
            <p>Account Email: <strong>${email}</strong></p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function getGuestBookingConfirmationTemplate(booking) {
  const {
    full_name,
    email,
    booking_reference,
    check_in,
    check_out,
    nights,
    guests,
    price_per_night,
    total_amount,
    caution_fee = 0,
    access_code
  } = booking;

  const checkInDate = new Date(check_in).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const checkOutDate = new Date(check_out).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const roomTotal = nights * price_per_night;

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Booking Confirmed - HomeWhize</title>
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%); padding: 40px 20px; text-align: center; color: white; }
          .content { padding: 40px 30px; line-height: 1.6; }
          .booking-details { background: #F6EEE2; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #0F4D3C; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #ddd; }
          .detail-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
          .total-row { background: #0F4D3C; color: white; padding: 15px; border-radius: 6px; text-align: center; font-size: 18px; font-weight: bold; margin-top: 15px; }
          .success-message { background: #DFF6EA; color: #0F4D3C; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0; border: 1px solid #0F4D3C; }
          .access-code { background: #FFF1DB; color: #C27B3E; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0; border: 1px solid #C27B3E; }
          .footer { background: #f8f8f8; padding: 20px 30px; text-align: center; color: #666; font-size: 14px; }
          .reference-highlight { background: #FFF1DB; color: #C27B3E; padding: 10px; border-radius: 4px; display: inline-block; font-weight: bold; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Booking Confirmed!</h1>
            <p>Your shortlet reservation has been successfully processed</p>
          </div>
          <div class="content">
            <div class="success-message">
              🎉 <strong>Congratulations ${full_name}!</strong><br />
              Your booking has been confirmed and payment processed successfully.
            </div>

            <div style="text-align:center; margin:20px 0;">
              <span class="reference-highlight">Booking Reference: ${booking_reference}</span>
            </div>

            <div class="booking-details">
              <h3 style="margin-top: 0; color: #0F4D3C;">📅 Booking Details</h3>
              <div class="detail-row"><span><strong>Check-in:</strong></span><span>${checkInDate}</span></div>
              <div class="detail-row"><span><strong>Check-out:</strong></span><span>${checkOutDate}</span></div>
              <div class="detail-row"><span><strong>Duration:</strong></span><span>${nights} night${nights > 1 ? 's' : ''}</span></div>
              <div class="detail-row"><span><strong>Guests:</strong></span><span>${guests} guest${guests > 1 ? 's' : ''}</span></div>
              <div class="detail-row"><span><strong>Price per Night:</strong></span><span>₦${price_per_night.toLocaleString()}</span></div>
              <div class="detail-row"><span><strong>Room Total:</strong></span><span>₦${roomTotal.toLocaleString()}</span></div>
              ${caution_fee > 0 ? `<div class="detail-row"><span><strong>Caution Fee:</strong></span><span>₦${caution_fee.toLocaleString()}</span></div>` : ''}
              <div class="total-row">Total Amount Paid: ₦${total_amount.toLocaleString()}</div>
            </div>

            <div class="access-code">
              🔐 <strong>Access Code: ${access_code}</strong><br />
              <small>Please present this code upon arrival for verification</small>
            </div>

            <p>Dear ${full_name},</p>
            <p>Thank you for choosing HomeWhize for your accommodation needs. Your booking has been confirmed.</p>
            <p><strong>Important:</strong> Please keep your access code safe and present it to the property owner upon arrival for verification.</p>

            <p>We wish you a pleasant stay!</p>
            <p>Best regards,<br /><strong>The HomeWhize Team</strong></p>
          </div>
          <div class="footer">
            <p>&copy; 2026 HomeWhize. All rights reserved.</p>
            <p>Booking Reference: <strong>${booking_reference}</strong></p>
            <p>Account Email: <strong>${email}</strong></p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function getOwnerBookingNotificationTemplate(booking, property) {
  const {
    full_name,
    email,
    phone,
    booking_reference,
    check_in,
    check_out,
    nights,
    guests,
    access_code
  } = booking;

  const checkInDate = new Date(check_in).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const checkOutDate = new Date(check_out).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const ownerName = property.admin_name || "Property Owner";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>New Booking Notification - HomeWhize</title>
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #0F4D3C 0%, #1a6b55 100%); padding: 40px 20px; text-align: center; color: white; }
          .content { padding: 40px 30px; line-height: 1.6; }
          .booking-details { background: #F6EEE2; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #0F4D3C; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #ddd; }
          .detail-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
          .guest-info { background: #E8F4F8; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #0F4D3C; }
          .access-code { background: #FFF1DB; color: #C27B3E; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0; border: 1px solid #C27B3E; }
          .notification-message { background: #DFF6EA; color: #0F4D3C; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0; border: 1px solid #0F4D3C; }
          .footer { background: #f8f8f8; padding: 20px 30px; text-align: center; color: #666; font-size: 14px; }
          .reference-highlight { background: #FFF1DB; color: #C27B3E; padding: 10px; border-radius: 4px; display: inline-block; font-weight: bold; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Booking Alert!</h1>
            <p>You have received a new booking for ${property.name}</p>
          </div>
          <div class="content">
            <div class="notification-message">
              📅 <strong>New Booking Confirmed</strong><br />
              A guest has successfully booked your property and completed payment.
            </div>

            <div style="text-align:center; margin:20px 0;">
              <span class="reference-highlight">Booking Reference: ${booking_reference}</span>
            </div>

            <div class="booking-details">
              <h3 style="margin-top: 0; color: #0F4D3C;">📅 Booking Details</h3>
              <div class="detail-row"><span><strong>Property:</strong></span><span>${property.name}</span></div>
              <div class="detail-row"><span><strong>Check-in:</strong></span><span>${checkInDate}</span></div>
              <div class="detail-row"><span><strong>Check-out:</strong></span><span>${checkOutDate}</span></div>
              <div class="detail-row"><span><strong>Duration:</strong></span><span>${nights} night${nights > 1 ? 's' : ''}</span></div>
              <div class="detail-row"><span><strong>Guests:</strong></span><span>${guests} guest${guests > 1 ? 's' : ''}</span></div>
            </div>

            <div class="guest-info">
              <h3 style="margin-top: 0; color: #0F4D3C;">👤 Guest Information</h3>
              <div class="detail-row"><span><strong>Name:</strong></span><span>${full_name}</span></div>
              <div class="detail-row"><span><strong>Email:</strong></span><span>${email}</span></div>
              <div class="detail-row"><span><strong>Phone:</strong></span><span>${phone}</span></div>
            </div>

            <div class="access-code">
              🔐 <strong>Access Code: ${access_code}</strong><br />
              <small>The guest will present this code upon arrival for verification</small>
            </div>

            <p>Dear ${ownerName},</p>
            <p>A new booking has been confirmed for your property. The guest has completed payment and will be arriving on the specified check-in date.</p>
            <p><strong>Important:</strong> Please verify the guest's access code (${access_code}) upon their arrival to ensure security.</p>

            <p>Best regards,<br /><strong>The HomeWhize Team</strong></p>
          </div>
          <div class="footer">
            <p>&copy; 2026 HomeWhize. All rights reserved.</p>
            <p>Booking Reference: <strong>${booking_reference}</strong></p>
          </div>
        </div>
      </body>
    </html>
  `;
}
