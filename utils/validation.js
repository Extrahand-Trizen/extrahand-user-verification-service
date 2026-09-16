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

/**
 * Clean and format GSTIN number
 * @param {string} gstin - GSTIN number to clean
 * @returns {string} Cleaned GSTIN number (uppercase, trimmed, no spaces/hyphens)
 */
function cleanGstinNumber(gstin) {
  if (!gstin || typeof gstin !== 'string') {
    return '';
  }
  return gstin.replace(/[\s-]/g, '').trim().toUpperCase();
}

/**
 * Validate GSTIN number format (15 alphanumeric characters)
 * Standard Indian GSTIN regex: 2 digits (state) + 5 letters (PAN) + 4 digits (PAN) + 1 letter (PAN) + 1 entity char + 'Z' + 1 check char
 * @param {string} gstin - GSTIN to validate
 * @returns {boolean}
 */
function isValidGstinFormat(gstin) {
  if (!gstin || typeof gstin !== 'string') {
    return false;
  }
  const cleaned = cleanGstinNumber(gstin);
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(cleaned);
}

/**
 * Mask GSTIN number (format: 29XXXXXXXXX1ZR)
 * Preserves the 2-digit state code and last 3 characters for verification visibility while protecting identity
 * @param {string} gstin - 15-character GSTIN
 * @returns {string} Masked GSTIN
 */
function maskGSTIN(gstin) {
  const cleaned = cleanGstinNumber(gstin);
  if (!cleaned || cleaned.length !== 15) {
    return 'XXXXXXXXXXXXXXX';
  }
  return `${cleaned.slice(0, 2)}XXXXXXXXX${cleaned.slice(-4)}`;
}

module.exports = {
  isValidAadhaarFormat,
  cleanAadhaarNumber,
  isValidOtpFormat,
  maskAadhaar,
  isValidRefId,
  cleanGstinNumber,
  isValidGstinFormat,
  maskGSTIN
};

