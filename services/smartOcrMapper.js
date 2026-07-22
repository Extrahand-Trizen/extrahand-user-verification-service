/**
 * Single mapping layer from Cashfree Smart OCR → internal domain model.
 * Provider switching: add new mappers here, keep services unchanged.
 */

const {
  extractFraudSummary,
  extractQualitySummary,
  extractQrSummary,
} = require('../utils/sanitizeCashfreeResponse');
const { maskFromLastFour, maskAadhaarNumber } = require('../utils/masking');

function pickDocumentFields(raw) {
  return raw.document_fields || raw.documentFields || raw.data?.document_fields || {};
}

function pickQrDetails(raw) {
  return raw.qr_details || raw.qrDetails || raw.data?.qr_details || {};
}

function pickFraudChecks(raw) {
  return raw.fraud_checks || raw.fraudChecks || raw.data?.fraud_checks || {};
}

function pickQualityChecks(raw) {
  return raw.quality_checks || raw.qualityChecks || raw.data?.quality_checks || {};
}

/**
 * Map Cashfree /bharat-ocr response to internal shape.
 * @param {object} raw - provider response body
 * @param {'front'|'back'} side
 */
function mapOcrResponse(raw, side = 'front') {
  const doc = pickDocumentFields(raw);
  const qr = pickQrDetails(raw);
  const fraud = pickFraudChecks(raw);
  const quality = pickQualityChecks(raw);

  const verificationStatus =
    raw.verification_status || raw.verificationStatus || raw.status || null;

  const uid = doc.uid || doc.aadhaar_number || doc.aadhaarNumber;
  const lastFour =
    qr.aadhaar_last_four_digit ||
    qr.aadhaar_last_four_digits ||
    doc.aadhaar_last_four_digit ||
    (uid && String(uid).replace(/\D/g, '').slice(-4)) ||
    null;

  let maskedAadhaar = null;
  if (uid && String(uid).replace(/\D/g, '').length === 12) {
    maskedAadhaar = maskAadhaarNumber(String(uid).replace(/\D/g, ''));
  } else if (lastFour) {
    maskedAadhaar = maskFromLastFour(lastFour);
  }

  const fraudSummary = extractFraudSummary(fraud);
  const qualitySummary = extractQualitySummary(quality);
  const qrSummary = extractQrSummary(qr);
  const qrValidationStatus = qr.status || qrSummary.status || null;

  const dob =
    doc.dob ||
    doc.date_of_birth ||
    doc.dateOfBirth ||
    qr.dob ||
    qr.date_of_birth ||
    null;
  const yearOfBirth =
    doc.year_of_birth || doc.yob || doc.dob_year || (dob && /^\d{4}/.test(String(dob)) ? String(dob).slice(0, 4) : null);

  return {
    side,
    verificationStatus,
    providerRefId: raw.reference_id || raw.ref_id || raw.referenceId || null,
    maskedAadhaar,
    name: doc.name || doc.full_name || qr.name || qr.full_name || null,
    dob: dob ? String(dob).trim() : null,
    yearOfBirth: yearOfBirth ? String(yearOfBirth).trim() : null,
    gender: doc.gender || qr.gender || null,
    address: doc.address || qr.address || qr.structured_address || null,
    fraudSummary,
    qualitySummary,
    qrValidationStatus,
    qrSummary,
    // Never expose downstream:
    _omit: { uid, photo_link: qr.photo_link || qr.photoLink },
  };
}

module.exports = {
  mapOcrResponse,
  pickDocumentFields,
  pickQrDetails,
};
