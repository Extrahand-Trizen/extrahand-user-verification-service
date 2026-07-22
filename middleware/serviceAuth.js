const logger = require('../config/logger');

/**
 * Service Authentication Middleware
 * Validates service-to-service calls using shared secret
 * Completely independent implementation
 */

const SERVICE_AUTH_TOKEN = process.env.SERVICE_AUTH_TOKEN;

if (!SERVICE_AUTH_TOKEN) {
  throw new Error('SERVICE_AUTH_TOKEN environment variable is required');
}

function serviceAuthMiddleware(req, res, next) {
  const token = req.headers['x-service-auth'];
  
  if (!token) {
    logger.warn('Missing service authentication token', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    return res.status(401).json({
      success: false,
      error: 'Missing service authentication token',
      code: 'MISSING_SERVICE_AUTH'
    });
  }

  if (token !== SERVICE_AUTH_TOKEN) {
    logger.warn('Invalid service authentication token', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    return res.status(401).json({
      success: false,
      error: 'Invalid service authentication token',
      code: 'INVALID_SERVICE_AUTH'
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

