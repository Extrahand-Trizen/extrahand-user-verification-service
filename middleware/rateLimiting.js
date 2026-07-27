const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');

/**
 * Per-user rate limiting middleware for OTP operations
 * Prevents abuse by limiting OTP requests per user
 */

/**
 * Rate limiter for OTP generation
 * Max 3 OTP requests per user per hour
 */
const otpGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Max 3 requests per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  
  // Key generator: use user ID from header or IP as fallback
  keyGenerator: (req) => {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    if (userId) {
      return `otp-gen-user:${userId}`;
    }
    // Fallback to IP if no user ID (shouldn't happen with service auth)
    return `otp-gen-ip:${req.ip}`;
  },
  
  // Custom handler for rate limit exceeded
  handler: (req, res) => {
    const userId = req.headers['x-user-id'] || req.body?.userId || 'unknown';
    
    logger.warn('⚠️ OTP generation rate limit exceeded', {
      userId,
      ip: req.ip,
      path: req.path
    });
    
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many OTP requests. Please try again after 1 hour.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: '1 hour'
    });
  },
  
  // Skip function: skip rate limiting in test environment
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * Rate limiter for OTP resend
 * Max 5 resend requests per user per hour (more lenient than generation)
 */
const otpResendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Max 5 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  
  keyGenerator: (req) => {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    if (userId) {
      return `otp-resend-user:${userId}`;
    }
    return `otp-resend-ip:${req.ip}`;
  },
  
  handler: (req, res) => {
    const userId = req.headers['x-user-id'] || req.body?.userId || 'unknown';
    
    logger.warn('⚠️ OTP resend rate limit exceeded', {
      userId,
      ip: req.ip,
      path: req.path
    });
    
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many OTP resend requests. Please try again after 1 hour.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: '1 hour'
    });
  },
  
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * Rate limiter for OTP verification attempts
 * Max 10 verification attempts per user per 15 minutes
 */
const otpVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  
  keyGenerator: (req) => {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    if (userId) {
      return `otp-verify-user:${userId}`;
    }
    return `otp-verify-ip:${req.ip}`;
  },
  
  handler: (req, res) => {
    const userId = req.headers['x-user-id'] || req.body?.userId || 'unknown';
    
    logger.warn('⚠️ OTP verification rate limit exceeded', {
      userId,
      ip: req.ip,
      path: req.path
    });
    
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many verification attempts. Please try again after 15 minutes.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: '15 minutes'
    });
  },
  
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * Global rate limiter for all verification endpoints
 * Max 100 requests per IP per 15 minutes (general protection)
 */
const globalVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  
  keyGenerator: (req) => {
    return `global:${req.ip}`;
  },
  
  handler: (req, res) => {
    logger.warn('⚠️ Global rate limit exceeded', {
      ip: req.ip,
      path: req.path
    });
    
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many requests from this IP. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: '15 minutes'
    });
  },
  
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  }
});

module.exports = {
  otpGenerationLimiter,
  otpResendLimiter,
  otpVerificationLimiter,
  globalVerificationLimiter
};

