/**
 * Per-user daily OCR attempt rate limit (configurable).
 */

const logger = require('../config/logger');
const KycSession = require('../models/KycSession');

const MAX_PER_DAY = parseInt(process.env.OCR_RATE_LIMIT_PER_DAY, 10) || 5;

async function ocrRateLimitMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'] || req.serviceUserId;
  if (!userId) return next();

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const count = await KycSession.countDocuments({
      userId,
      sessionType: 'aadhaar_ocr',
      createdAt: { $gte: startOfDay },
    });

    if (count >= MAX_PER_DAY) {
      logger.warn('OCR rate limit exceeded', { userId, count, max: MAX_PER_DAY });
      return res.status(429).json({
        success: false,
        error: 'Daily OCR attempt limit reached',
        code: 'OCR_RATE_LIMIT',
        retryAfter: '24h',
      });
    }
  } catch (e) {
    logger.warn('OCR rate limit check failed — allowing request', { error: e.message });
  }

  return next();
}

module.exports = { ocrRateLimitMiddleware, MAX_PER_DAY };
