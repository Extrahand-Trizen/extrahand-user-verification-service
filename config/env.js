const { z } = require('zod');
const fs = require('fs');
const path = require('path');

// Define environment schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).refine(n => n > 0 && n < 65536, 'Port must be between 1-65535').default('4004'),
  
  // MongoDB
  MONGODB_URI: z.string().url('Invalid MongoDB URI').optional(),
  MONGODB_DB: z.string().default('extrahand_verifications'),
  
  // Service Authentication (for inter-service communication)
  SERVICE_AUTH_TOKEN: z.string().min(1, 'SERVICE_AUTH_TOKEN is required'),
  
  // ===== PROVIDER SELECTION =====
  VERIFICATION_PROVIDER: z.enum(['cashfree', 'signzy', 'karza']).default('cashfree'),
  
  // ===== CASHFREE CONFIGURATION (ACTIVE) =====
  CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CASHFREE_CLIENT_ID: z.string().min(1, 'CASHFREE_CLIENT_ID is required'),
  CASHFREE_CLIENT_SECRET: z.string().min(1, 'CASHFREE_CLIENT_SECRET is required'),
  CASHFREE_TEST_OTP: z.string().default('111000'),
  
  // Cashfree URLs (auto-set based on environment)
  CASHFREE_SANDBOX_URL: z.string().url().default('https://sandbox.cashfree.com/verification'),
  CASHFREE_PRODUCTION_URL: z.string().url().default('https://api.cashfree.com/verification'),
  
  // ===== SIGNZY CONFIGURATION (FUTURE - OPTIONAL) =====
  SIGNZY_API_KEY: z.string().optional(),
  SIGNZY_API_SECRET: z.string().optional(),
  SIGNZY_BASE_URL: z.string().url().optional(),
  
  // ===== KARZA CONFIGURATION (FUTURE - OPTIONAL) =====
  KARZA_API_KEY: z.string().optional(),
  KARZA_API_SECRET: z.string().optional(),
  KARZA_BASE_URL: z.string().url().optional(),
  
  // ===== FEATURE FLAGS =====
  FEATURE_AADHAAR: z.string().default('true'),
  FEATURE_PAN: z.string().default('false'),
  FEATURE_BANK: z.string().default('false'),
  FEATURE_FACE: z.string().default('false'),
  FEATURE_LIVENESS: z.string().default('false'),
  
  // Main Backend URL (for callbacks if needed)
  MAIN_BACKEND_URL: z.string().url().optional(),
  
  // User Service URL (for updating user profiles after verification)
  USER_SERVICE_URL: z.string().url().optional(),
  
  // DigiLocker redirect URL (frontend callback after user completes DigiLocker flow)
  DIGILOCKER_REDIRECT_URL: z.string().url().optional(),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Security
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  
  // CORS
  CORS_ORIGIN: z.string().optional(),
  
  // Health check
  HEALTH_CHECK_PATH: z.string().default('/health'),
});

// Centralized CORS configuration
function getCorsConfig(env) {
  const isDevelopment = env.NODE_ENV === 'development';
  
  // Define allowed origins
  const allowedOrigins = [
    'https://extrahand.in',
    'https://www.extrahand.in',
    'http://localhost:3000',
    'http://localhost:4000',
    'http://localhost:4004',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4000',
    'http://127.0.0.1:4004',
    'http://127.0.0.1:8080'
  ];
  
  // Add custom origins from environment if provided
  if (env.CORS_ORIGIN) {
    const customOrigins = env.CORS_ORIGIN.split(',').map(origin => origin.trim());
    allowedOrigins.push(...customOrigins);
  }
  
  return {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      }
    },
    credentials: true,
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Service-Auth',
      'X-User-Id',
      'X-Service-Name',
      'Cache-Control',
      'Pragma'
    ],
    preflightContinue: false,
    exposedHeaders: ['Content-Length'],
    maxAge: 86400 // 24 hours
  };
}

// Get Cashfree base URL based on environment
function getCashfreeBaseUrl(env) {
  return env.CASHFREE_ENV === 'production' 
    ? env.CASHFREE_PRODUCTION_URL 
    : env.CASHFREE_SANDBOX_URL;
}

function validateEnv() {
  try {
    const env = envSchema.parse(process.env);
    
    // Validate MongoDB URI if provided
    if (!env.MONGODB_URI && env.NODE_ENV === 'production') {
      throw new Error('MONGODB_URI is required in production');
    }
    
    // Log configuration
    console.log('✅ Environment validation successful');
    console.log(`   Environment: ${env.NODE_ENV}`);
    console.log(`   Port: ${env.PORT}`);
    console.log(`   Verification Provider: ${env.VERIFICATION_PROVIDER}`);
    console.log(`   Cashfree Environment: ${env.CASHFREE_ENV}`);
    console.log(`   Cashfree Base URL: ${getCashfreeBaseUrl(env)}`);
    console.log(`   MongoDB: ${env.MONGODB_URI ? 'Configured' : 'Not configured (in-memory fallback)'}`);
    console.log(`   DigiLocker Redirect: ${env.DIGILOCKER_REDIRECT_URL || 'Not configured'}`);
    console.log('   Feature Flags:');
    console.log(`     - Aadhaar: ${env.FEATURE_AADHAAR === 'true' ? '✅ ENABLED' : '🔒 DISABLED'}`);
    console.log(`     - PAN: ${env.FEATURE_PAN === 'true' ? '✅ ENABLED' : '🔒 DISABLED (ready)'}`);
    console.log(`     - Bank: ${env.FEATURE_BANK === 'true' ? '✅ ENABLED' : '🔒 DISABLED (ready)'}`);
    console.log(`     - Face: ${env.FEATURE_FACE === 'true' ? '✅ ENABLED' : '🔒 DISABLED (ready)'}`);
    console.log(`     - Liveness: ${env.FEATURE_LIVENESS === 'true' ? '✅ ENABLED' : '🔒 DISABLED (ready)'}`);
    
    return {
      ...env,
      CASHFREE_BASE_URL: getCashfreeBaseUrl(env)
    };
  } catch (error) {
    console.error('❌ Environment validation failed:');
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error(`  - ${error.message}`);
    }
    process.exit(1);
  }
}

module.exports = { 
  validateEnv, 
  envSchema, 
  getCorsConfig,
  getCashfreeBaseUrl
};

