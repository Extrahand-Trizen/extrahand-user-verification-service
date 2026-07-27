const { KYC_VAULT_CONFIG } = require('../config/kycVault.config');

/**
 * Validate uploaded image buffer for OCR.
 */
function validateOcrImageUpload({ buffer, mimetype, size }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, code: 'EMPTY_FILE', message: 'Image file is required' };
  }
  if (size > KYC_VAULT_CONFIG.maxUploadBytes) {
    return {
      valid: false,
      code: 'FILE_TOO_LARGE',
      message: `Image must be under ${Math.floor(KYC_VAULT_CONFIG.maxUploadBytes / 1024 / 1024)}MB`,
    };
  }
  if (!KYC_VAULT_CONFIG.allowedMimeTypes.includes(mimetype)) {
    return {
      valid: false,
      code: 'INVALID_MIME',
      message: 'Only JPEG, PNG, or WebP images are allowed',
    };
  }
  return { valid: true };
}

/**
 * Cashfree verification_id max 50 chars.
 */
function buildCashfreeOcrVerificationId(prefix = 'ocr') {
  const crypto = require('crypto');
  const id = `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  return id.length > 50 ? id.slice(0, 50) : id;
}

const ACTIVE_DIGILOCKER_STATUSES = ['pending', 'in_progress', 'completing'];
const ACTIVE_OCR_INTERNAL_STATUSES = [
  'awaiting_front',
  'awaiting_back',
  'processing',
  'completing',
];

/** Session still occupying user OCR slot (includes delayed visibility windows) */
const ACTIVE_OCR_BLOCKING_STATUSES = [
  ...ACTIVE_OCR_INTERNAL_STATUSES,
  'completed', // under_review until visible verified
  'failed', // under_review until visible failed
];

module.exports = {
  validateOcrImageUpload,
  buildCashfreeOcrVerificationId,
  ACTIVE_DIGILOCKER_STATUSES,
  ACTIVE_OCR_INTERNAL_STATUSES,
  ACTIVE_OCR_BLOCKING_STATUSES,
};
