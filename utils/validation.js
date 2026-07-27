/**
 * Validation utilities for verification service
 */

/**
 * Validate Aadhaar number format
 * @param {string} aadhaarNumber - Aadhaar number to validate
 * @returns {boolean}
 */
function isValidAadhaarFormat(aadhaarNumber) {
  if (!aadhaarNumber || typeof aadhaarNumber !== 'string') {
    return false;
  }
  
  // Remove spaces and hyphens
  const cleaned = aadhaarNumber.replace(/[\s-]/g, '');
  
  // Must be exactly 12 digits
  return /^\d{12}$/.test(cleaned);
}

/**
 * Clean and format Aadhaar number
 * @param {string} aadhaarNumber - Aadhaar number to clean
 * @returns {string} Cleaned Aadhaar number (12 digits)
 */
function cleanAadhaarNumber(aadhaarNumber) {
  if (!aadhaarNumber) {
    return '';
  }
  
  // Remove spaces, hyphens, and other non-digit characters
  return aadhaarNumber.replace(/[\s-]/g, '');
}

/**
 * Validate OTP format
 * @param {string} otp - OTP to validate
 * @returns {boolean}
 */
function isValidOtpFormat(otp) {
  if (!otp || typeof otp !== 'string') {
    return false;
  }
  
  // OTP should be 6 digits
  return /^\d{6}$/.test(otp);
}

/**
 * Mask Aadhaar number (format: XXXX XXXX 1234)
 * @param {string} aadhaarNumber - 12-digit Aadhaar number
 * @returns {string} Masked Aadhaar number
 */
function maskAadhaar(aadhaarNumber) {
  if (!aadhaarNumber || aadhaarNumber.length !== 12) {
    return 'XXXX XXXX XXXX';
  }
  const last4 = aadhaarNumber.slice(-4);
  return `XXXX XXXX ${last4}`;
}

/**
 * Validate refId/transactionId format
 * @param {string} refId - Reference ID to validate
 * @returns {boolean}
 */
function isValidRefId(refId) {
  if (!refId || typeof refId !== 'string') {
    return false;
  }
  
  // RefId should be non-empty string
  return refId.trim().length > 0;
}

module.exports = {
  isValidAadhaarFormat,
  cleanAadhaarNumber,
  isValidOtpFormat,
  maskAadhaar,
  isValidRefId
};

