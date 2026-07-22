const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { validateEnv, getCorsConfig } = require('./config/env');
const logger = require('./config/logger');
const verificationRouter = require('./routes/verification');
const emailVerificationRouter = require('./routes/emailVerification');
const ocrAadhaarRouter = require('./routes/ocrAadhaar');
const webhooksRouter = require('./routes/webhooks');
const digilockerService = require('./services/digilockerService');
const smartOcrService = require('./services/smartOcrService');
const kycVaultStorage = require('./services/kycVaultStorage');
const { EmailServiceClient } = require('./services/emailServiceClient');
const { startOcrJobs } = require('./jobs');

// Validate environment variables
const env = validateEnv();

// Initialize DigiLocker service (Aadhaar verification via Cashfree)
digilockerService.initialize(env);
smartOcrService.initialize(env);
kycVaultStorage.initialize();
EmailServiceClient.initialize();
startOcrJobs();

const app = express();

// Trust proxy if behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting - DISABLED temporarily
// const limiter = rateLimit({
//   windowMs: env.RATE_LIMIT_WINDOW_MS,
//   max: env.RATE_LIMIT_MAX_REQUESTS,
//   message: {
//     success: false,
//     error: 'Too many requests from this IP, please try again later.',
//     retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000 / 60),
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
// });
// app.use('/api/', limiter);

// CORS configuration
const corsOptions = getCorsConfig(env);
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body parsing and compression
app.use(compression());

// Webhook route MUST use raw body for signature verification (before express.json)
app.use('/api/v1/webhooks/cashfree', express.raw({ type: 'application/json' }));
app.use('/api/v1/webhooks/cashfree', webhooksRouter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Data sanitization
app.use(mongoSanitize());

// Logging middleware
if (env.NODE_ENV === 'production') {
  app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
  }));
} else {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'ok',
    service: 'extrahand-user-verification',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    version: '1.0.0',
    memory: process.memoryUsage(),
    pid: process.pid
  };

  try {
    // Check MongoDB connection
    if (env.MONGODB_URI) {
      if (mongoose.connection.readyState !== 1) {
        healthCheck.mongodb = 'disconnected';
        healthCheck.status = 'degraded';
      } else {
        healthCheck.mongodb = 'connected';
      }
    } else {
      healthCheck.mongodb = 'not_configured';
    }

    // Check DigiLocker service (Cashfree DigiLocker API)
    healthCheck.digilocker = {
      environment: env.CASHFREE_ENV,
      initialized: digilockerService.initialized
    };

    res.status(healthCheck.status === 'ok' ? 200 : 503).json(healthCheck);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// API routes
app.use('/api/v1/verification', verificationRouter);
app.use('/api/v1/verification', emailVerificationRouter);
app.use('/api/v1/verification', ocrAadhaarRouter);

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Global error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  const isDevelopment = env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    success: false,
    error: isDevelopment ? error.message : 'Internal server error',
    ...(isDevelopment && { stack: error.stack }),
    timestamp: new Date().toISOString()
  });
});

module.exports = app;

