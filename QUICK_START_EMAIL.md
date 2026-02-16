# Quick Start: Email Automation System

## ⚡ 30-Second Setup

### 1. Ensure Environment Variables
```env
# Add to .env file
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-app-specific-password
```

### 2. Start Backend
```bash
cd "Homewhize Backend/HomeWhize Backend"
npm start
```

### 3. Test (Optional)
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "TestPass123!"
  }'
# Check email inbox for welcome email ✉️
```

**Done!** ✅ Emails are now automatic.

---

## 📧 What Emails Are Sent

| User Action | Email Sent | Includes |
|-------------|-----------|----------|
| Signs up manually | ✅ Welcome email | Account confirmation, features, next steps |
| Signs up with Google | ✅ Google welcome email | Google connection confirmation, KYC reminder |
| Admin creates owner | ✅ Welcome + KYC | Temp password, instructions, KYC benefits |
| Changes password | ✅ Confirmation | Success message, security tips |
| Resets password | ✅ Confirmation | Reset confirmation, security tips |

---

## 🎯 API Endpoints

### Create Owner (Send Emails Automatically)
```
POST /api/admin/create-owner
Authorization: Bearer {admin_token}

{
  "name": "John Doe",
  "email": "john@example.com",
  "role": "owner"
}
```

**Emails sent automatically:**
- Welcome email (with temp password)
- KYC reminder email

### Manual Signup (Sends Email Automatically)
```
POST /api/auth/register

{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "SecurePass123!",
  "role": "user"
}
```

**Email sent:** Signup acknowledgment

---

## 🔑 Temporary Password

When admins create owners/users:
```
Username: owner@example.com
Temporary Password: Homewhize@2026
```

Owner must change password on first login.

---

## 📁 New Files Created

```
Homewhize Backend/HomeWhize Backend/
├── utils/
│   └── emailService.js                    (Email functions & templates)
├── EMAIL_AUTOMATION_DOCUMENTATION.md      (Complete guide)
├── API_TESTING_EMAIL_GUIDE.md            (Testing guide)
└── IMPLEMENTATION_SUMMARY.md              (What was implemented)

Homewhize Frontend/
└── FRONTEND_EMAIL_IMPLEMENTATION.md       (Frontend integration guide)
```

---

## 📝 Modified Files

```
Homewhize Backend/HomeWhize Backend/
├── controllers/
│   ├── authController.js       (+ sendSignupEmail, password change)
│   ├── googleController.js     (+ sendSignupEmail for Google)
│   ├── adminController.js      (+ createOwner, sendWelcomeEmail)
│   └── passwordController.js   (+ sendPasswordChangeEmail)
├── routes/
│   └── adminRoutes.js          (+ POST /create-owner)
```

---

## 🧪 Quick Test

### Test Create Owner
```bash
# Get admin token first
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin-password"
  }'

# Copy the token from response, then...

curl -X POST http://localhost:5000/api/admin/create-owner \
  -H "Authorization: Bearer PASTE_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "role": "owner"
  }'

# Emails should arrive in inbox in 1-2 seconds
```

---

## 🎨 Email Branding

All emails feature:
- ✅ HomeWhize green color (#0F4D3C)
- ✅ Professional HTML design
- ✅ Mobile responsive layout
- ✅ Clear call-to-action buttons
- ✅ Security best practices
- ✅ Support contact information

---

## 🔍 Check Email Logs

If emails aren't arriving, check backend logs:
```bash
# Terminal where npm start is running
# Look for: "Signup email sent successfully"
# Or: "Email sending failed"
```

---

## ⚙️ Email Configuration

### Gmail Setup
1. Go to: https://myaccount.google.com/security
2. Enable "2-Step Verification"
3. Generate App Password
4. Add to `.env`:
```env
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

### Other Email Providers
See `EMAIL_AUTOMATION_DOCUMENTATION.md`

---

## 🛠️ Troubleshooting

### Emails not received?
```bash
# 1. Check .env file
grep EMAIL .env

# 2. Verify backend is running
npm start

# 3. Check spam folder
Gmail → Spam folder

# 4. Check logs for errors
# Look in terminal where npm start runs
```

### API returns error?
- Ensure authentication token is valid
- Verify email format (must be valid email)
- Check required fields are provided

---

## 📊 Email System Architecture

```
User Action (signup, password change, etc.)
    ↓
Controller Function
    ↓
Database Operation
    ↓
sendEmail*() called (async, non-blocking)
    ↓
Email sent via Gmail SMTP
    ↓
API returns success immediately
(Email delivery happens in background)
```

**Key:** Emails are sent asynchronously, won't block user operations.

---

## 📚 Full Documentation

- **Setup & Troubleshooting:** `EMAIL_AUTOMATION_DOCUMENTATION.md`
- **API Testing:** `API_TESTING_EMAIL_GUIDE.md`
- **Frontend Integration:** `FRONTEND_EMAIL_IMPLEMENTATION.md`
- **Implementation Details:** `IMPLEMENTATION_SUMMARY.md`

---

## ✨ Features Implemented

✅ **5 Professional Email Templates**
  - Manual signup
  - Google signup
  - Owner welcome (with temp password)
  - Password change confirmation
  - KYC reminder

✅ **Automatic Email Sending**
  - No manual intervention needed
  - Sent automatically on user actions
  - Non-blocking (async)
  - Error handling included

✅ **Professional Branding**
  - HomeWhize colors and logo
  - Mobile-responsive design
  - Security best practices
  - Clear instructions

✅ **Complete Documentation**
  - Setup guide
  - API documentation
  - Testing procedures
  - Troubleshooting guide

✅ **Production Ready**
  - Error handling
  - Security measures
  - Scalable architecture
  - Tested and verified

---

## 🚀 That's It!

The email system is:
- ✅ Fully implemented
- ✅ Ready to use
- ✅ Well documented
- ✅ Production ready

**Start using it now!** 🎉

---

## 💡 Pro Tips

1. **Test emails:** Use your own email to test before going live
2. **Monitor deliverability:** Check logs for any email failures
3. **Customize templates:** Edit `emailService.js` to change colors/text
4. **Expand later:** Add more email scenarios as needed (booking confirmations, receipts, etc.)

---

**Need Help?**
- Check the documentation files
- Review the API testing guide
- Check backend logs for errors
- Verify .env configuration
