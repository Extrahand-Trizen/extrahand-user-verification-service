/**
 * Redact Cashfree Smart OCR payloads before persistence, logging, or debugging.
 * NEVER store raw OCR JSON, full Aadhaar, or qr photo_link.
 */

const { maskFromLastFour, maskNameForLog, maskAadhaarNumber } = require('./masking');

const REDACTED = '[redacted]';

const UID_FIELD_NAMES = new Set([
  'uid',
  'aadhaar_number',
  'aadhaarnumber',
  'aadhaar',
]);

function maskUidValue(value) {
  if (value == null || value === '') return value;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 12) return maskAadhaarNumber(digits);
  if (digits.length === 4) return maskFromLastFour(digits);
  return REDACTED;
}

/** Deep-clone object; mask UID-like keys and drop photo_link */
function redactOcrObject(obj, depth = 0) {
  if (obj == null || depth > 8) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => redactOcrObject(item, depth + 1));
  }
  if (typeof obj !== 'object') return obj;

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (lower === 'photo_link' || lower === 'photolink') {
      out[key] = REDACTED;
      continue;
    }
    if (UID_FIELD_NAMES.has(lower)) {
      out[key] = maskUidValue(value);
      continue;
    }
    if (value && typeof value === 'object') {
      out[key] = redactOcrObject(value, depth + 1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Full Cashfree OCR body safe for terminal logs (keeps name/dob/address; masks UID).
 * @param {object} raw
 */
function formatCashfreeResponseForLog(raw) {
  if (!raw || typeof raw !== 'object') {
    return { payload: null };
  }

  const docFields = raw.document_fields || raw.documentFields || {};
  const qr = raw.qr_details || raw.qrDetails || {};
  const fraud = raw.fraud_checks || raw.fraudChecks || {};
  const quality = raw.quality_checks || raw.qualityChecks || {};

  return {
    verification_id: raw.verification_id || raw.verificationId || null,
    verification_status: raw.verification_status || raw.verificationStatus || null,
    document_type: raw.document_type || raw.documentType || null,
    reference_id: raw.reference_id || raw.ref_id || raw.referenceId || null,
    document_fields: redactOcrObject(docFields),
    qr_details: redactOcrObject(qr),
    fraud_checks: fraud,
    quality_checks: quality,
  };
}

/**
 * Pretty-print Cashfree OCR response to terminal (dev / opt-in).
 * Set CASHFREE_OCR_LOG_RESPONSE=false to disable.
 */
function logCashfreeResponseToTerminal(raw, context = {}) {
  if (process.env.CASHFREE_OCR_LOG_RESPONSE === 'false') {
    return;
  }

  const payload = formatCashfreeResponseForLog(raw);
  const sideLabel = context.side ? ` [${context.side}]` : '';
  const label = context.error
    ? `Cashfree Smart OCR ERROR${sideLabel}`
    : `Cashfree Smart OCR response${sideLabel}`;

  // eslint-disable-next-line no-console
  console.log(`\n========== ${label} ==========`);
  if (context.verificationId) {
    // eslint-disable-next-line no-console
    console.log('verificationId:', context.verificationId);
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload, null, 2));
  // eslint-disable-next-line no-console
  console.log('==========================================\n');
}

/**
 * Extract safe fraud summary booleans only.
 */
function extractFraudSummary(fraudChecks = {}) {
  return {
    is_screenshot: !!fraudChecks.is_screenshot,
    is_photo_of_screen: !!fraudChecks.is_photo_of_screen,
    is_photo_imposed: !!fraudChecks.is_photo_imposed,
    is_overwritten: !!fraudChecks.is_overwritten,
    is_forged: !!fraudChecks.is_forged,
  };
}

/**
 * Extract safe quality summary booleans only.
 */
function extractQualitySummary(qualityChecks = {}) {
  return {
    blur: !!qualityChecks.blur,
    glare: !!qualityChecks.glare,
    partially_present: !!qualityChecks.partially_present,
    obscured: !!qualityChecks.obscured,
    face_present: !!qualityChecks.face_present,
    face_clear: !!qualityChecks.face_clear,
    qr_present: !!qualityChecks.qr_present,
  };
}

/**
 * Safe QR metadata — no photo_link, no full Aadhaar.
 */
function extractQrSummary(qrDetails = {}) {
  const lastFour =
    qrDetails.aadhaar_last_four_digit ||
    qrDetails.aadhaar_last_four_digits ||
    qrDetails.last_four_digit ||
    null;

  return {
    status: qrDetails.status || null,
    aadhaarLastFourMasked: lastFour ? maskFromLastFour(lastFour) : null,
    hasStructuredAddress: !!(qrDetails.address || qrDetails.structured_address),
  };
}

/**
 * Build persistable OCR metadata from mapped provider response.
 * @param {object} mapped - output of smartOcrMapper.mapOcrResponse
 */
function buildPersistableOcrMetadata(mapped) {
  if (!mapped) return null;

  return {
    verificationStatus: mapped.verificationStatus || null,
    maskedAadhaar: mapped.maskedAadhaar || null,
    fraudSummary: mapped.fraudSummary || extractFraudSummary(),
    qualitySummary: mapped.qualitySummary || extractQualitySummary(),
    qrValidationStatus: mapped.qrValidationStatus || null,
    qrSummary: mapped.qrSummary || extractQrSummary(),
    nameInitial: mapped.name ? maskNameForLog(mapped.name) : null,
    dob: mapped.dob || null,
    yearOfBirth: mapped.yearOfBirth || null,
    gender: mapped.gender || null,
    hasAddress: !!mapped.address,
    providerRefId: mapped.providerRefId || null,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Sanitize full Cashfree response for safe logging.
 * @param {object} raw
 */
function sanitizeCashfreeResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { sanitized: true, payload: null };
  }

  const docFields = raw.document_fields || raw.documentFields || {};
  const qr = raw.qr_details || raw.qrDetails || {};
  const fraud = raw.fraud_checks || raw.fraudChecks || {};
  const quality = raw.quality_checks || raw.qualityChecks || {};

  const lastFour =
    qr.aadhaar_last_four_digit ||
    docFields.aadhaar_last_four_digit ||
    null;

  return {
    sanitized: true,
    verification_id: raw.verification_id || raw.verificationId || null,
    verification_status: raw.verification_status || raw.verificationStatus || null,
    document_type: raw.document_type || raw.documentType || null,
    maskedAadhaar: lastFour ? maskFromLastFour(lastFour) : REDACTED,
    fraudSummary: extractFraudSummary(fraud),
    qualitySummary: extractQualitySummary(quality),
    qrStatus: qr.status || null,
    // Explicitly omitted: document_fields.uid, qr.photo_link, file buffers, raw JSON
  };
}

module.exports = {
  sanitizeCashfreeResponse,
  formatCashfreeResponseForLog,
  logCashfreeResponseToTerminal,
  buildPersistableOcrMetadata,
  extractFraudSummary,
  extractQualitySummary,
  extractQrSummary,
  REDACTED,
};
