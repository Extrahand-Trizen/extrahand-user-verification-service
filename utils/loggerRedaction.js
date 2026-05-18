/**
 * Winston-safe metadata redaction for OCR/KYC logs.
 */

const { sanitizeCashfreeResponse } = require('./sanitizeCashfreeResponse');

const SENSITIVE_KEYS = [
  'aadhaar',
  'aadhaar_number',
  'aadhaarNumber',
  'uid',
  'photo_link',
  'photoLink',
  'file',
  'buffer',
  'raw',
  'document_fields',
  'qr_details',
  'ocrPayload',
];

function redactValue(key, value) {
  if (value == null) return value;
  const lower = String(key).toLowerCase();
  if (SENSITIVE_KEYS.some((k) => lower.includes(k))) {
    return '[redacted]';
  }
  if (Buffer.isBuffer(value)) {
    return `[buffer:${value.length}b]`;
  }
  return value;
}

/**
 * Shallow-redact an object for logging.
 */
function redactForLog(meta = {}) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
      if (key === 'cashfreeResponse' || key === 'ocrResponse') {
        out[key] = sanitizeCashfreeResponse(value);
      } else {
        out[key] = redactForLog(value);
      }
    } else {
      out[key] = redactValue(key, value);
    }
  }
  return out;
}

module.exports = { redactForLog, SENSITIVE_KEYS };
