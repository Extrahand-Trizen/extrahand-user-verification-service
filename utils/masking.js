/**
 * Centralized PII masking for Aadhaar and related fields.
 */

const { maskAadhaar: maskAadhaar12 } = require('./validation');

/**
 * Mask 12-digit Aadhaar → XXXX XXXX 1234
 * @param {string} aadhaarNumber
 */
function maskAadhaarNumber(aadhaarNumber) {
  if (!aadhaarNumber) return 'XXXX XXXX XXXX';
  const cleaned = String(aadhaarNumber).replace(/\D/g, '');
  if (cleaned.length === 12) return maskAadhaar12(cleaned);
  if (cleaned.length === 4) return `XXXX XXXX ${cleaned}`;
  return 'XXXX XXXX XXXX';
}

/**
 * Mask from last-four only (from QR or OCR field).
 * @param {string} lastFour
 */
function maskFromLastFour(lastFour) {
  const digits = String(lastFour || '').replace(/\D/g, '').slice(-4);
  if (digits.length !== 4) return 'XXXX XXXX XXXX';
  return `XXXX XXXX ${digits}`;
}

/**
 * Mask a free-form name for logs (first char + stars).
 */
function maskNameForLog(name) {
  if (!name || typeof name !== 'string') return '[redacted]';
  const trimmed = name.trim();
  if (trimmed.length <= 1) return '*';
  return `${trimmed[0]}${'*'.repeat(Math.min(trimmed.length - 1, 8))}`;
}

module.exports = {
  maskAadhaarNumber,
  maskFromLastFour,
  maskNameForLog,
};
