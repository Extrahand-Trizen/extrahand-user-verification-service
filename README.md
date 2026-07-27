# ExtraHand User Verification Service

Standalone microservice for user verification (Aadhaar KYC) using Cashfree API.

## Overview

This service handles:
- Aadhaar e-KYC verification via Cashfree
- OTP generation and verification
- Verification status management
- Compliance data storage (masked)

## Features

- ✅ Sandbox and Production environment support
- ✅ Easy switching between sandbox and production
- ✅ Service-to-service authentication
- ✅ Comprehensive error handling
- ✅ Production-grade logging
- ✅ Rate limiting and security
- ✅ MongoDB integration with fallback

### Production-Ready Features (v1.1.0)

- ✅ **OTP Expiration**: OTPs expire after 10 minutes for security
- ✅ **Retry Logic**: Automatic retries with exponential backoff for transient failures
- ✅ **Resend OTP**: Dedicated endpoint for resending OTPs with cooldown protection
- ✅ **Per-User Rate Limiting**: Prevent abuse with user-specific rate limits
- ✅ **Enhanced Error Categorization**: Clear error codes and user-friendly messages
- ✅ **Cooldown Periods**: 60-second cooldown between OTP resends

See [PRODUCTION_READY_FEATURES.md](./PRODUCTION_READY_FEATURES.md) for detailed documentation.

## Prerequisites

- Node.js >= 18
- MongoDB (optional - has in-memory fallback)
- Cashfree account with API credentials

## Installation

```bash
cd extrahand-user-verification
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update `.env` with your credentials:
```env
# Service Authentication
SERVICE_AUTH_TOKEN=your-shared-secret-token

# Cashfree Sandbox Credentials (for testing)
CASHFREE_ENV=sandbox
CASHFREE_CLIENT_ID=your_sandbox_client_id
CASHFREE_CLIENT_SECRET=your_sandbox_client_secret

# MongoDB (optional)
MONGODB_URI=mongodb://localhost:27017/extrahand_verifications
```

## Running the Service

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

The service will start on port 4004 (default).

## API Endpoints

### Health Check
```
GET /health
```

### Initiate Aadhaar Verification
```
POST /api/v1/verification/aadhaar/initiate
Headers:
  X-Service-Auth: <service-auth-token>
  X-User-Id: <user-id>
Body:
  {
    "aadhaarNumber": "655675523712",
    "consentGiven": true
  }
```

### Verify Aadhaar OTP
```
POST /api/v1/verification/aadhaar/verify
Headers:
  X-Service-Auth: <service-auth-token>
  X-User-Id: <user-id>
Body:
  {
    "refId": "21637861",
    "otp": "111000"
  }
```

### Get Verification Status
```
GET /api/v1/verification/status/:userId
Headers:
  X-Service-Auth: <service-auth-token>
```

### Get Verification Badge
```
GET /api/v1/verification/badge/:userId
Headers:
  X-Service-Auth: <service-auth-token>
```

## Switching to Production

To switch from sandbox to production:

1. Update `.env`:
```env
CASHFREE_ENV=production
CASHFREE_CLIENT_ID=your_production_client_id
CASHFREE_CLIENT_SECRET=your_production_client_secret
```

2. Restart the service:
```bash
npm start
```

The service automatically uses the correct Cashfree endpoints based on `CASHFREE_ENV`.

## Test Data (Sandbox)

Use these test Aadhaar numbers in sandbox:

| Aadhaar Number | OTP | Result |
|---------------|-----|--------|
| 655675523712 | 111000 | ✅ Success |
| 655675523712 | 000111 | ❌ OTP Invalid |
| 655675523710 | 111000 | ❌ Invalid Aadhaar |

Standard test OTP: `111000`

## Integration with Main Backend

The main backend can call this service using:

```javascript
const VERIFICATION_SERVICE_URL = process.env.VERIFICATION_SERVICE_URL || 'http://localhost:4004';
const SERVICE_AUTH_TOKEN = process.env.SERVICE_AUTH_TOKEN;

async function initiateVerification(userId, aadhaarNumber) {
  const response = await fetch(`${VERIFICATION_SERVICE_URL}/api/v1/verification/aadhaar/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Auth': SERVICE_AUTH_TOKEN,
      'X-User-Id': userId,
    },
    body: JSON.stringify({ aadhaarNumber, consentGiven: true })
  });
  return response.json();
}
```

## Project Structure

```
extrahand-user-verification/
├── config/
│   ├── env.js          # Environment validation
│   └── logger.js       # Winston logger
├── models/
│   └── Verification.js # Verification model
├── routes/
│   └── verification.js # API routes
├── services/
│   └── cashfreeService.js # Cashfree integration
├── middleware/
│   └── serviceAuth.js  # Service authentication
├── utils/
│   ├── validation.js   # Validation helpers
│   └── helpers.js      # Utility functions
├── logs/               # Log files
├── app.js              # Express app
├── server.js           # Server startup
├── mongo.js            # MongoDB connection
├── package.json
├── .env.example
└── README.md
```

## Logging

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only
- `logs/exceptions.log` - Uncaught exceptions
- `logs/rejections.log` - Unhandled rejections

## Security

- Service-to-service authentication via shared token
- Rate limiting (100 requests per 15 minutes)
- Input sanitization
- CORS protection
- Helmet security headers

## Error Handling

All errors are logged and return standardized responses:
```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## License

ISC

