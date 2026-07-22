const logger = require('../config/logger');

/**
 * Error categorization utility for production-ready error handling
 * Categorizes errors into retryable and non-retryable types
 */

class APIError extends Error {
  constructor(message, code, statusCode, isRetryable = false, originalError = null) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    this.originalError = originalError;
  }
}

/**
 * Error categories for better error handling
 */
const ErrorCategories = {
  // Network/Service errors (retryable)
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Client errors (non-retryable)
  INVALID_INPUT: 'INVALID_INPUT',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  
  // Verification specific errors
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  ALREADY_VERIFIED: 'ALREADY_VERIFIED',
  INVALID_AADHAAR: 'INVALID_AADHAAR',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Categorize error based on status code and error details
 * @param {Error} error - The error object
 * @param {Object} context - Additional context for error categorization
 * @returns {APIError} Categorized error
 */
function categorizeError(error, context = {}) {
  // Handle Axios errors
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data || {};
    const message = data.message || data.error || error.message;

    // 5xx errors - Server errors (retryable)
    if (status >= 500) {
      return new APIError(
        message || 'Service temporarily unavailable',
        ErrorCategories.SERVICE_UNAVAILABLE,
        status,
        true, // Retryable
        error
      );
    }

    // 429 - Rate limiting (retryable after delay)
    if (status === 429) {
      return new APIError(
        'Rate limit exceeded. Please try again later.',
        ErrorCategories.RATE_LIMIT_EXCEEDED,
        status,
        true, // Retryable after delay
        error
      );
    }

    // 401/403 - Authentication/Authorization (non-retryable)
    if (status === 401 || status === 403) {
      return new APIError(
        message || 'Authentication failed',
        ErrorCategories.AUTHENTICATION_ERROR,
        status,
        false,
        error
      );
    }

    // 404 - Not found (non-retryable)
    if (status === 404) {
      return new APIError(
        message || 'Resource not found',
        ErrorCategories.NOT_FOUND,
        status,
        false,
        error
      );
    }

    // 400 - Bad request (non-retryable)
    if (status === 400) {
      return new APIError(
        message || 'Invalid request',
        ErrorCategories.INVALID_INPUT,
        status,
        false,
        error
      );
    }

    // Other 4xx errors (non-retryable)
    if (status >= 400 && status < 500) {
      return new APIError(
        message,
        ErrorCategories.INVALID_INPUT,
        status,
        false,
        error
      );
    }
  }

  // Handle network errors (retryable)
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new APIError(
      'Request timeout. Please try again.',
      ErrorCategories.TIMEOUT_ERROR,
      408,
      true,
      error
    );
  }

  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return new APIError(
      'Network error. Please check your connection.',
      ErrorCategories.NETWORK_ERROR,
      503,
      true,
      error
    );
  }

  // Unknown errors (cautiously treat as non-retryable)
  return new APIError(
    error.message || 'An unexpected error occurred',
    ErrorCategories.UNKNOWN_ERROR,
    500,
    false,
    error
  );
}

/**
 * Sleep function for retry delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result of the function
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = (error) => error.isRetryable,
    onRetry = null
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Attempt the function
      return await fn();
    } catch (error) {
      lastError = error;

      // Categorize the error
      const categorizedError = categorizeError(error);
      
      // Check if we should retry
      const isLastAttempt = attempt === maxRetries - 1;
      const shouldRetryThis = shouldRetry(categorizedError);

      if (isLastAttempt || !shouldRetryThis) {
        // Don't retry - throw the categorized error
        logger.error('❌ Operation failed (no retry)', {
          attempt: attempt + 1,
          maxRetries,
          errorCode: categorizedError.code,
          isRetryable: categorizedError.isRetryable,
          message: categorizedError.message
        });
        throw categorizedError;
      }

      // Log retry attempt
      logger.warn(`⚠️ Attempt ${attempt + 1}/${maxRetries} failed, retrying...`, {
        errorCode: categorizedError.code,
        nextDelay: delay,
        message: categorizedError.message
      });

      // Call onRetry callback if provided
      if (onRetry) {
        await onRetry(attempt + 1, categorizedError, delay);
      }

      // Wait before retrying
      await sleep(delay);

      // Exponential backoff with max delay cap
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  // This shouldn't be reached, but just in case
  throw lastError;
}

/**
 * Get user-friendly error message based on error code
 * @param {string} errorCode - Error code from ErrorCategories
 * @returns {string} User-friendly message
 */
function getUserFriendlyMessage(errorCode) {
  const messages = {
    [ErrorCategories.NETWORK_ERROR]: 'Network connection issue. Please check your internet connection and try again.',
    [ErrorCategories.TIMEOUT_ERROR]: 'Request timed out. Please try again.',
    [ErrorCategories.SERVICE_UNAVAILABLE]: 'Service is temporarily unavailable. Please try again in a few moments.',
    [ErrorCategories.INVALID_INPUT]: 'Invalid input provided. Please check your information and try again.',
    [ErrorCategories.AUTHENTICATION_ERROR]: 'Authentication failed. Please check your credentials.',
    [ErrorCategories.AUTHORIZATION_ERROR]: 'You are not authorized to perform this action.',
    [ErrorCategories.NOT_FOUND]: 'The requested resource was not found.',
    [ErrorCategories.OTP_EXPIRED]: 'OTP has expired. Please request a new one.',
    [ErrorCategories.OTP_INVALID]: 'Invalid OTP. Please check and try again.',
    [ErrorCategories.OTP_ATTEMPTS_EXCEEDED]: 'Maximum OTP attempts exceeded. Please request a new OTP.',
    [ErrorCategories.ALREADY_VERIFIED]: 'This account is already verified.',
    [ErrorCategories.INVALID_AADHAAR]: 'Invalid Aadhaar number. Please check and try again.',
    [ErrorCategories.RATE_LIMIT_EXCEEDED]: 'Too many requests. Please wait a moment and try again.',
    [ErrorCategories.UNKNOWN_ERROR]: 'An unexpected error occurred. Please try again.'
  };

  return messages[errorCode] || messages[ErrorCategories.UNKNOWN_ERROR];
}

module.exports = {
  APIError,
  ErrorCategories,
  categorizeError,
  retryWithBackoff,
  sleep,
  getUserFriendlyMessage
};

