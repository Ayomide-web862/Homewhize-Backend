# HomeWhize Email Automation System Documentation

## Overview

This document describes the complete email automation system implemented for HomeWhize using **Nodemailer**. The system automatically sends customized emails in various user scenarios with professional HomeWhize branding.

---

## 📧 Email Templates & Scenarios

### 1. **Manual Signup Acknowledgment**
- **Trigger:** When a user signs up manually via the signup form
- **Recipient:** New user
- **Content:**
  - Welcome message
  - Account activation confirmation
  - Features overview
  - Call to action to explore properties
  - Support contact information

**Email Template Features:**
- HomeWhize branded header with green theme (#0F4D3C)
- Welcoming tone
- Clear next steps
- Footer with privacy policy and terms

**Example:**
```
Subject: Welcome to HomeWhize - Account Created Successfully
Content: Professional HTML email with HomeWhize branding
```

---

### 2. **Google Signup Acknowledgment**
- **Trigger:** When a user signs up via Google authentication
- **Recipient:** New user (Google auth)
- **Content:**
  - Welcome message highlighting easy login
  - Google account connection confirmation
  - Security assurance
  - Ready-to-explore features
  - Recommendation to complete KYC

**Email Template Features:**
- Google account connection badge
- Security emphasis
- Premium features highlight
- Call to action for KYC completion

**Example:**
```
Subject: Welcome to HomeWhize - Google Signup Confirmation
Content: Tailored for Google auth users with KYC call-to-action
```

---

### 3. **Owner/User Account Creation from Admin Panel**
- **Trigger:** When an admin creates a new owner/user account via `/api/admin/create-owner`
- **Recipient:** Newly created owner/user
- **Content:**
  - Personalized welcome message
  - **Temporary Password:** `Homewhize@2026`
  - Login credentials (email + temp password)
  - Step-by-step instructions to:
    1. Access admin dashboard
    2. Navigate to settings
    3. Change password
    4. Complete KYC verification
  - Security warning about temporary password
  - Support contact information

**Email Template Features:**
- Professional credentials display box
- Numbered step-by-step instructions
- Password change warning
- KYC completion emphasis
- Support box with next steps

**Example:**
```
POST /api/admin/create-owner
Body: {
  "name": "John Doe",
  "email": "john@example.com",
  "role": "owner"
}

Response: {
  "message": "Owner account created successfully. Welcome email sent.",
  "userId": 123
}

Email sent with:
- Name: John Doe
- Email: john@example.com
- Temporary Password: Homewhize@2026
- Instructions for password change and KYC
```

---

### 4. **Password Change Confirmation**
- **Trigger:** When a user successfully changes their password via `/api/auth/change-password` or `/api/password/reset-password`
- **Recipient:** User who changed password
- **Content:**
  - Success confirmation
  - Date and time of change
  - Security tips:
    - Never share password
    - Use strong passwords
    - Change regularly
    - Monitor account activity
    - Logout from other devices if needed
  - Instruction to contact support if unauthorized

**Email Template Features:**
- Success icon/badge
- Green color scheme for positive action
- Security best practices
- Contact support link
- Timestamp of change

**Example:**
```
Subject: Password Change Confirmation - HomeWhize
Content: Password changed on Feb 16, 2026 at 3:45 PM
Content: Security tips and reassurance messaging
```

---

### 5. **KYC Verification Reminder**
- **Trigger:** Automatically sent when a new owner/user account is created via admin panel (with 1-second delay)
- **Recipient:** New owner/user
- **Content:**
  - Friendly reminder about KYC importance
  - Benefits of completing KYC:
    - Full payment access
    - Analytics and reports
    - Premium badge
    - Exclusive offers
  - Required documents:
    - Valid ID (Passport/Driver's License/National ID)
    - Proof of ownership/occupancy
    - Personal information
  - Time estimate: 5-10 minutes
  - Call to action to complete KYC
  - Support contact information

**Email Template Features:**
- Important reminder tone
- Benefits grid display
- Clear requirements list
- Time estimate to reduce anxiety
- Direct link to KYC page
- Support contact

**Example:**
```
Subject: Complete Your KYC Verification - HomeWhize
Content: Benefits, requirements, and easy action link
Sent to: New owners/users after account creation
```

---

## 🔧 Implementation Details

### Email Service (`utils/emailService.js`)

All email sending functions are centralized in a reusable service:

```javascript
// Import the email service
import { 
  sendSignupEmail, 
  sendWelcomeEmail, 
  sendPasswordChangeEmail,
  sendKYCReminderEmail 
} from "../utils/emailService.js";

// Send signup email
await sendSignupEmail(
  { name: "John", email: "john@example.com" }, 
  "manual" // or "google"
);

// Send welcome email with temporary password
await sendWelcomeEmail(
  "John Doe",
  "john@example.com",
  "Homewhize@2026",
  "owner" // role: "owner", "admin", or "user"
);

// Send password change confirmation
await sendPasswordChangeEmail(
  "John Doe",
  "john@example.com"
);

// Send KYC reminder
await sendKYCReminderEmail(
  "John Doe",
  "john@example.com"
);
```

### Environment Variables Required

```env
# Email Configuration
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-specific-password
```

**For Gmail:**
1. Enable 2-Factor Authentication on your Google Account
2. Generate an App-Specific Password
3. Use that password as `EMAIL_PASS`

---

## 📚 API Endpoints

### 1. Create Owner Account
```
POST /api/admin/create-owner
Headers: Authorization: Bearer {token}
Role Required: superadmin, master, admin

Body:
{
  "name": "String (required)",
  "email": "String (required, unique)",
  "role": "String (optional: 'user', 'owner', 'admin' - default: 'user')"
}

Response:
{
  "message": "Owner account created successfully. Welcome email sent.",
  "userId": 123
}

Emails Sent:
1. Welcome email with temporary password: Homewhize@2026
2. KYC reminder email (after 1 second)
```

### 2. User Signup (Manual)
```
POST /api/auth/register
Body:
{
  "name": "String (required)",
  "email": "String (required, unique)",
  "password": "String (required, min 8 chars)",
  "role": "String (optional - defaults to 'user')"
}

Response:
{
  "message": "User registered successfully",
  "role": "user"
}

Email Sent:
- Signup acknowledgment with welcome message and next steps
```

### 3. User Signup (Google)
```
POST /api/google/auth
Body:
{
  "token": "String (Google ID token)"
}

Response:
{
  "message": "Login successful",
  "token": "JWT token",
  "user": {...}
}

Email Sent (for new users only):
- Google signup acknowledgment with KYC call-to-action
```

### 4. Change Password
```
POST /api/auth/change-password
Headers: Authorization: Bearer {token}
Role Required: Authenticated user

Body:
{
  "currentPassword": "String (required)",
  "newPassword": "String (required, min 8 chars)"
}

Response:
{
  "message": "Password updated successfully"
}

Email Sent:
- Password change confirmation with security tips
```

### 5. Password Reset
```
POST /api/password/reset-password
Body:
{
  "email": "String (required)",
  "resetToken": "String (from OTP verification)",
  "newPassword": "String (required, min 8 chars)"
}

Response:
{
  "message": "Password reset successfully"
}

Email Sent:
- Password change confirmation with security tips
```

---

## 🎨 Email Design & Branding

All emails follow HomeWhize branding guidelines:

### Colors
- **Primary Green:** `#0F4D3C` (HomeWhize brand color)
- **Secondary Green:** `#1a6b55` (gradient darker)
- **Accent Color:** `#E07000` (warnings/emphasis)
- **Background:** `#F6EEE2` (warm beige)

### Typography
- **Font Family:** Poppins (fallback: Arial)
- **Header:** Large, bold, white on green background
- **Content:** Clean, readable, 14px for body text

### Structure
- HomeWhize header with branding
- Personalized greeting
- Main content section
- Call-to-action button
- Support/help section
- Footer with links and copyright

---

## 🛠️ Troubleshooting

### Emails Not Sending

**Issue:** Emails are not being delivered

**Solutions:**
1. **Verify Email Credentials:**
   - Check `EMAIL_USER` and `EMAIL_PASS` in `.env`
   - For Gmail: Use App-Specific Password, not regular password

2. **Check Email Limits:**
   - Gmail has rate limits
   - Implement email queue if sending many emails

3. **Verify Email Format:**
   - Ensure recipient email is valid format
   - Check for typos in email addresses

4. **Check Logs:**
   ```bash
   # Look for email sending errors in console
   console.error() messages in controllers
   ```

### Emails in Spam/Junk

**Solutions:**
1. Add SPF, DKIM, DMARC records to domain
2. Use branded email address (not generic)
3. Ensure proper email headers
4. Add unsubscribe link (if bulk sending)

---

## 📊 Email Tracking & Logging

All email send attempts are logged:

```javascript
// Success log
console.log("Signup email sent successfully:", info.response);

// Error log
console.error("Email sending failed:", error);

// Warning (email fails but request succeeds)
console.warn("Failed to send welcome email:", emailErr);
```

Emails fail gracefully - if email sending fails, the primary operation (signup,  password change, account creation) still succeeds.

---

## 🔒 Security Considerations

1. **Temporary Passwords:**
   - Always `Homewhize@2026` for new accounts
   - Users must change on first login
   - Consider adding expiration if needed

2. **Email Data:**
   - Emails contain sensitive info (passwords)
   - Ensure secure SMTP connection (Gmail uses TLS)
   - Never log full passwords

3. **Rate Limiting:**
   - Consider implementing rate limits on email endpoints
   - Prevent email bombing/abuse

4. **Email Verification:**
   - Consider adding email verification step for new signups
   - Already implemented for password reset (OTP)

---

## 📱 Mobile Optimization

All email templates are mobile-responsive:
- Responsive grid layouts
- Touch-friendly button sizes
- Readable font sizes
- Proper padding/margins

---

## 🔄 Future Enhancements

Potential additions to the email system:

1. **Email Verification for Signups**
   - Send verification link to confirm email
   - Activate account only after verification

2. **Property Notifications**
   - Send emails when property bookings occur
   - Booking confirmations and reminders

3. **Newsletter**
   - Weekly property updates
   - New listings and offers
   - Community highlights

4. **Email Templates Management**
   - Admin dashboard to customize templates
   - Brand color configuration
   - Dynamic content insertion

5. **Email Queue System**
   - Queue emails for high-volume scenarios
   - Retry failed emails
   - Track delivery status

6. **Unsubscribe Management**
   - Email preference center
   - Unsubscribe links
   - Frequency preferences

---

## 📞 Support

For issues or questions about the email system, check:
1. Email logs in console
2. Verify .env configuration
3. Check email template HTML
4. Verify SMTP credentials with Gmail

---

## 📝 Version History

- **v1.0** (Feb 16, 2026) - Initial implementation
  - Signup acknowledgment emails
  - Owner account creation with welcome email
  - Password change confirmation emails
  - KYC reminder emails
  - Professional HTML templates with HomeWhize branding

---

## 🎯 Quick Reference

| Scenario | Trigger | Email Type | Recipient |
|----------|---------|-----------|-----------|
| Manual Signup | User registers | Welcome | New user |
| Google Signup | User signs in with Google (new) | Welcome (Google) | New user |
| Owner Creation | Admin creates owner | Welcome + KYC | New owner |
| Password Change | User changes password | Confirmation | User |
| Password Reset | User resets password via OTP | Confirmation | User |
| KYC Reminder | After owner account creation | Reminder | Owner |

---

**Happy emailing! 🚀**
