# Email Automation - API Testing Guide

Quick reference for testing the email automation system with curl and Postman.

---

## 1. Setup

### Environment Variables
Ensure your `.env` file has:
```env
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-specific-password
JWT_SECRET=your-jwt-secret
NODE_ENV=development
```

### Start Backend Server
```bash
cd "Homewhize Backend/HomeWhize Backend"
npm start
```

Server runs on: `http://localhost:5000`

---

## 2. Test Endpoints

### A. Create Owner Account (Sends Welcome + KYC Reminder Emails)

**Endpoint:** `POST /api/admin/create-owner`

#### Using cURL
```bash
curl -X POST http://localhost:5000/api/admin/create-owner \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john.doe@example.com",
    "role": "owner"
  }'
```

#### Using Postman
1. **Method:** POST
2. **URL:** `http://localhost:5000/api/admin/create-owner`
3. **Headers:**
   - `Authorization: Bearer YOUR_ADMIN_TOKEN`
   - `Content-Type: application/json`
4. **Body (raw JSON):**
```json
{
  "name": "John Doe",
  "email": "john.doe@example.com",
  "role": "owner"
}
```

#### Expected Response
```json
{
  "message": "Owner account created successfully. Welcome email sent.",
  "userId": 123
}
```

#### Emails Sent
1. **Welcome Email:** Contains temporary password, login instructions, password change steps
2. **KYC Reminder Email:** (sent after 1 second) Explains KYC importance and benefits

---

### B. Manual User Signup (Sends Signup Acknowledgment Email)

**Endpoint:** `POST /api/auth/register`

#### Using cURL
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane.smith@example.com",
    "password": "SecurePass123!",
    "role": "user"
  }'
```

#### Using Postman
1. **Method:** POST
2. **URL:** `http://localhost:5000/api/auth/register`
3. **Body (raw JSON):**
```json
{
  "name": "Jane Smith",
  "email": "jane.smith@example.com",
  "password": "SecurePass123!",
  "role": "user"
}
```

#### Expected Response
```json
{
  "message": "User registered successfully",
  "role": "user"
}
```

#### Email Sent
- **Signup Acknowledgment Email:** Welcome message with features overview and next steps

---

### C. Google Authentication Signup (Sends Google Signup Email for New Users)

**Endpoint:** `POST /api/google/auth`

#### Using cURL
```bash
curl -X POST http://localhost:5000/api/google/auth \
  -H "Content-Type: application/json" \
  -d '{
    "token": "GOOGLE_ID_TOKEN_HERE"
  }'
```

**Note:** To get a valid Google token:
1. Use Google OAuth flow from your frontend
2. Copy the token from the response
3. Use it in this request

#### Expected Response (for new user)
```json
{
  "message": "Login successful",
  "token": "JWT_TOKEN",
  "user": {
    "id": 456,
    "name": "Google User",
    "email": "googleuser@gmail.com",
    "role": "user"
  }
}
```

#### Email Sent (new users only)
- **Google Signup Email:** Highlights easy login and KYC completion

---

### D. Change Password (Sends Confirmation Email)

**Endpoint:** `POST /api/auth/change-password`

#### Prerequisites
1. User must be authenticated
2. Need active JWT token

#### Using cURL
```bash
curl -X POST http://localhost:5000/api/auth/change-password \
  -H "Authorization: Bearer USER_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "CurrentPass123!",
    "newPassword": "NewSecurePass456!"
  }'
```

#### Using Postman
1. **Method:** POST
2. **URL:** `http://localhost:5000/api/auth/change-password`
3. **Headers:**
   - `Authorization: Bearer USER_JWT_TOKEN`
4. **Body (raw JSON):**
```json
{
  "currentPassword": "CurrentPass123!",
  "newPassword": "NewSecurePass456!"
}
```

#### Expected Response
```json
{
  "message": "Password updated successfully"
}
```

#### Email Sent
- **Password Change Confirmation:** Security tips and reassurance

---

### E. Password Reset via OTP (Sends Confirmation Email)

**Step 1: Request OTP**

```bash
curl -X POST http://localhost:5000/api/password/request-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

**Step 2: Verify OTP**

```bash
curl -X POST http://localhost:5000/api/password/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "otp": "123456"
  }'
```

Response includes `resetToken`

**Step 3: Reset Password**

```bash
curl -X POST http://localhost:5000/api/password/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "resetToken": "TOKEN_FROM_VERIFY_OTP",
    "newPassword": "NewPassword123!"
  }'
```

#### Expected Response
```json
{
  "message": "Password reset successfully"
}
```

#### Email Sent
- **Password Change Confirmation:** After step 3 completes

---

## 3. Getting Admin Token for Testing

### Step 1: Login as Admin

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "AdminPassword123!"
  }'
```

### Step 2: Copy Token from Response

```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

### Step 3: Use Token in Authorization Header

```bash
# Replace YOUR_ADMIN_TOKEN with the token from above
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 4. Postman Collection Example

Save as `HomeWhize-Email-Tests.json`:

```json
{
  "info": {
    "name": "HomeWhize Email Automation",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Auth - Login",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"email\": \"admin@example.com\",\n  \"password\": \"AdminPassword123!\"\n}"
        },
        "url": {
          "raw": "http://localhost:5000/api/auth/login",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5000",
          "path": ["api", "auth", "login"]
        }
      }
    },
    {
      "name": "Admin - Create Owner",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "Authorization",
            "value": "Bearer {{admin_token}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"name\": \"Test Owner\",\n  \"email\": \"testowner@example.com\",\n  \"role\": \"owner\"\n}"
        },
        "url": {
          "raw": "http://localhost:5000/api/admin/create-owner",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5000",
          "path": ["api", "admin", "create-owner"]
        }
      }
    },
    {
      "name": "Auth - Register User",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"name\": \"Test User\",\n  \"email\": \"testuser@example.com\",\n  \"password\": \"TestPass123!\",\n  \"role\": \"user\"\n}"
        },
        "url": {
          "raw": "http://localhost:5000/api/auth/register",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5000",
          "path": ["api", "auth", "register"]
        }
      }
    },
    {
      "name": "Auth - Change Password",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "Authorization",
            "value": "Bearer {{user_token}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"currentPassword\": \"CurrentPass123!\",\n  \"newPassword\": \"NewPass456!\"\n}"
        },
        "url": {
          "raw": "http://localhost:5000/api/auth/change-password",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5000",
          "path": ["api", "auth", "change-password"]
        }
      }
    }
  ]
}
```

Import this into Postman:
1. Open Postman
2. Click "Import"
3. Select the JSON file
4. Click "Import"

---

## 5. Testing Checklist

### Manual Signup Email Test
- [ ] User registers with manual signup
- [ ] User receives "Welcome to HomeWhize" email
- [ ] Email contains HomeWhize branding
- [ ] Email is mobile responsive
- [ ] Email has call-to-action button

### Owner Creation Email Test
- [ ] Admin creates owner account
- [ ] Owner receives welcome email within 5 seconds
- [ ] Welcome email contains:
  - [ ] Owner name
  - [ ] Email address
  - [ ] Temporary password: `Homewhize@2026`
  - [ ] Step-by-step password change instructions
  - [ ] KYC completion instructions
- [ ] Owner receives KYC reminder email within 5 seconds
- [ ] Both emails properly formatted

### Password Change Email Test
- [ ] User changes password
- [ ] User receives confirmation email
- [ ] Email contains:
  - [ ] Success message
  - [ ] Date and time of change
  - [ ] Security tips
  - [ ] Contact support link
- [ ] Email properly formatted

### Google Signup Email Test (if new user)
- [ ] User signs up via Google
- [ ] User receives welcome email
- [ ] Email mentions Google connection
- [ ] Email includes KYC reminder

---

## 6. Troubleshooting Tests

### Emails Not Arriving

1. **Check backend logs:**
   ```bash
   # Look for error messages
   npm start
   # Check terminal output
   ```

2. **Verify email configuration:**
   ```bash
   # Check .env file
   cat .env | grep EMAIL
   ```

3. **Check spam folder:**
   - Gmail often catches automated emails
   - Add sender to contacts if needed

4. **Verify credentials:**
   - For Gmail: Use App-Specific Password
   - Not your regular Gmail password

### API Returns 401 Unauthorized

- Ensure you have a valid JWT token
- Token might have expired (2 hour limit)
- Login again to get a new token

### API Returns 400 Bad Request

- Check required fields in request body
- Verify email format is valid
- Check password meets minimum length (8 chars)

### API Returns 429 Too Many Requests

- Rate limiting is active
- Wait a moment and retry
- Implement backoff strategy if bulk testing

---

## 7. Email Test Accounts

### For Development Testing

```
Email: test.homewhize@gmail.com
Purpose: Set this as EMAIL_USER in .env to receive all test emails
```

Or use multiple test emails:
```
test1@gmail.com
test2@gmail.com
test3@outlook.com
test4@yahoo.com
```

---

## 8. Expected Email Timeline

### Create Owner Account

```
T+0s    : API request received
T+0.1s  : Account created in database
T+0.5s  : Welcome email sent
T+1.5s  : KYC reminder email sent
T+2s    : API returns success response
```

### Manual Signup

```
T+0s    : API request received
T+0.1s  : User created in database
T+0.5s  : Signup email sent
T+1s    : API returns success response
```

---

## 9. Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Emails to spam folder | Add to contacts, check DKIM/SPF records |
| Delayed emails | Gmail rate limiting, wait and retry |
| Email format issues | Check email address format in request |
| 401 Unauthorized | Get new JWT token by logging in |
| SMTP errors | Verify EMAIL_USER and EMAIL_PASS in .env |

---

## 10. Security Testing

### Test Cases
- [ ] Invalid email format rejected
- [ ] XSS attempts in email address blocked
- [ ] SQL injection attempts blocked
- [ ] Unauthenticated requests to protected endpoints rejected
- [ ] Non-admin users cannot create owners

---

## Quick Start Reference

```bash
# 1. Start server
cd "Homewhize Backend/HomeWhize Backend"
npm start

# 2. In another terminal, test signup
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "TestPass123!"
  }'

# 3. Check your email inbox for welcome email

# Done! ✅
```

---

Happy testing! 🚀
