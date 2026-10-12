const logger = require('../config/logger');

/**
 * Service Authentication Middleware
 * Validates service-to-service calls using shared secret
 * Completely independent implementation
 */

function serviceAuthMiddleware(req, res, next) {
  const token = req.headers['x-service-auth'];
  const configuredToken = process.env.SERVICE_AUTH_TOKEN ? process.env.SERVICE_AUTH_TOKEN.trim() : null;

  if (!token || !configuredToken || token !== configuredToken) {
    logger.warn('Service authentication failed', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      hasToken: Boolean(token),
      hasConfiguredToken: Boolean(configuredToken),
    });

    return res.status(401).json({
      success: false,
      error: token ? 'Invalid service authentication token' : 'Missing service authentication token',
      code: token ? 'INVALID_SERVICE_AUTH' : 'MISSING_SERVICE_AUTH'
    });
  }

  // Extract user context if provided
  const userId = req.headers['x-user-id'];
  if (userId) {
    req.serviceUserId = userId;
  }

  // Extract service context if provided
  const serviceName = req.headers['x-service-name'];
  if (serviceName) {
    req.callingService = serviceName;
  }

  logger.debug('Service authentication successful', {
    service: serviceName || 'unknown',
    userId: userId || 'none',
    path: req.path
  });

  next();
}

module.exports = { serviceAuthMiddleware };

