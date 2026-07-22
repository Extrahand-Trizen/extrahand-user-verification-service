/**
 * Helper utility functions
 */

/**
 * Create standardized API response
 * @param {boolean} success - Whether the operation was successful
 * @param {any} data - Response data
 * @param {string} message - Optional message
 * @param {string} error - Optional error message
 * @returns {object} Standardized response object
 */
function createResponse(success, data = null, message = null, error = null) {
  const response = {
    success,
    timestamp: new Date().toISOString()
  };

  if (data !== null) {
    response.data = data;
  }

  if (message) {
    response.message = message;
  }

  if (error) {
    response.error = error;
  }

  return response;
}

/**
 * Create success response
 */
function successResponse(data = null, message = null) {
  return createResponse(true, data, message);
}

/**
 * Create error response
 * @param {string} error - Error message
 * @param {string} message - User-friendly message
 * @param {string} code - Error code (optional)
 */
function errorResponse(error, message = null, code = null) {
  const response = createResponse(false, null, message, error);
  
  if (code) {
    response.code = code;
  }
  
  return response;
}

/**
 * Extract IP address from request
 * @param {object} req - Express request object
 * @returns {string} IP address
 */
function getClientIp(req) {
  return req.ip 
    || req.connection.remoteAddress 
    || req.socket.remoteAddress 
    || (req.connection.socket ? req.connection.socket.remoteAddress : null)
    || 'unknown';
}

/**
 * Sanitize user input
 * @param {string} input - Input string to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input.trim().replace(/[<>]/g, '');
}

/**
 * Delay execution (for retries)
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  createResponse,
  successResponse,
  errorResponse,
  getClientIp,
  sanitizeInput,
  delay
};

