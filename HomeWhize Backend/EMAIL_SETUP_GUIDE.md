# Email Configuration Guide for HomeWhize

## Problem: Gmail 535 Authentication Error

Gmail no longer allows "less secure app" login. You must use one of these methods:

### ✅ **Recommended: App Password (Easiest)**

1. **Enable 2-Step Verification** on your Gmail account:
   - Go to [myaccount.google.com/security](https://myaccount.google.com/security)
   - Click **2-Step Verification** → **Get Started**
   - Complete the steps

2. **Generate App Password**:
   - Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   - Select "Mail" and "Windows Computer" (or your device)
   - Click **Generate**
   - Copy the 16-character password shown

3. **Set Environment Variables** in `.env`:
```env
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx
```

4. **Test it**:
```bash
npm run dev
```
Check logs for: `✅ Email transporter configured: gmail`

---

### Alternative: Custom SMTP Provider (SendGrid, Postmark, Mailgun)

**Better for Production:**
- SendGrid ([sendgrid.com](https://www.sendgrid.com))
- Postmark ([postmarkapp.com](https://postmarkapp.com))
- Mailgun ([mailgun.com](https://www.mailgun.com))

**Set `.env`**:
```env
EMAIL_SERVICE=custom
EMAIL_USER=apikey
EMAIL_PASS=SG.xxxxxxxxxxxxx_SendGridKeyHere
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_SECURE=false
```

---

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `EMAIL_SERVICE` | No | `gmail` or `custom` | `gmail` |
| `EMAIL_USER` | **Yes** | Sender email or API key | `admin@homewhize.com` |
| `EMAIL_PASS` | **Yes** | App Password or SMTP password | `xxxx xxxx xxxx xxxx` |
| `EMAIL_HOST` | If custom | SMTP server hostname | `smtp.sendgrid.net` |
| `EMAIL_PORT` | If custom | SMTP port | `587` |
| `EMAIL_SECURE` | If custom | Use TLS (true/false) | `false` |

---

## Troubleshooting

### Error: "EMAIL_USER and EMAIL_PASS are required"
- Check that `.env` exists in `HomeWhize Backend/` folder
- Verify variables are not blank
- Restart the backend after editing `.env`

### Error: "Username and Password not accepted (535)"
- You're using your Gmail **password** instead of **App Password**
- Use the 16-character App Password from step 2 above
- Don't use spaces in the password (if there are, remove them)

### Error: "Invalid login"
- Check that `EMAIL_USER` matches the Gmail account that generated the App Password
- Verify 2-Step Verification is enabled
- Try regenerating the App Password

### Emails still not sending?
- Check backend logs for `✅ Email transporter configured`
- Look for error messages in the console
- Uncomment `verifyEmailConnection()` call in `server.js` to test connection on startup

---

## Code Changes Made

1. **New file**: `config/emailConfig.js`
   - Consolidated, reusable email transporter
   - Supports Gmail and custom SMTP
   - Graceful error handling with logging

2. **Updated**: `utils/emailService.js`
   - Uses `sendEmailSafely()` from emailConfig
   - Returns null on failure instead of throwing
   - Non-blocking email sends (won't break user registration/password change)

3. **Updated**: `controllers/authController.js`
   - Removed duplicate Nodemailer setup
   - Emails handled gracefully in background

---

## Testing

**Manual Test via Postman**:

```
POST http://localhost:5000/api/auth/register
Content-Type: application/json

{
  "name": "Test User",
  "email": "your-test-email@gmail.com",
  "password": "TestPass123",
  "role": "user"
}
```

- Check `your-test-email@gmail.com` for signup acknowledgment email
- Check backend logs for: `✅ Signup email sent successfully to ...`

---

## Notes

- Emails are **non-blocking**: if sending fails, the operation (registration, password change, etc.) still succeeds
- Backend logs show `✅` (success), `⚠️` (warning), or `❌` (error) for each email attempt
- No need to restart backend for `.env` changes (email config reloads on demand)
