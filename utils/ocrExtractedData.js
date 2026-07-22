/**
 * Build and merge safe Aadhaar OCR extracted fields for API + persistence.
 * Never includes full UID or raw provider payloads.
 */

function lastFourFromMasked(maskedAadhaar) {
  if (!maskedAadhaar || typeof maskedAadhaar !== 'string') return null;
  const digits = maskedAadhaar.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function pickDob(doc = {}, qr = {}, mapped = {}) {
  const raw =
    doc.dob ||
    doc.date_of_birth ||
    doc.dateOfBirth ||
    qr.dob ||
    qr.date_of_birth ||
    mapped.dob ||
    null;
  if (raw) return String(raw).trim();
  const yob = doc.year_of_birth || doc.yob || doc.dob_year || mapped.yearOfBirth;
  if (yob) return String(yob).trim();
  return null;
}

function pickName(doc = {}, qr = {}) {
  const n = doc.name || doc.full_name || qr.name || qr.full_name;
  return n ? String(n).trim() : null;
}

function pickGender(doc = {}, qr = {}) {
  const g = doc.gender || qr.gender;
  return g ? String(g).trim() : null;
}

/**
 * Normalize address from string or structured Cashfree fields.
 */
function normalizeAddress(source) {
  if (!source) return null;
  if (typeof source === 'string') {
    const line = source.trim();
    return line ? { line1: line } : null;
  }
  if (typeof source !== 'object') return null;

  const structured = source.structured_address || source.structuredAddress;
  if (structured && typeof structured === 'object') {
    return {
      line1: structured.line1 || structured.house || structured.street || undefined,
      line2: structured.line2 || structured.landmark || undefined,
      city: structured.city || structured.vtc || structured.district || undefined,
      state: structured.state || undefined,
      pincode: structured.pincode || structured.pin || structured.pin_code || undefined,
    };
  }

  const line1 =
    source.line1 ||
    source.address_line1 ||
    source.house ||
    [source.care_of, source.street].filter(Boolean).join(', ') ||
    undefined;

  return {
    line1: line1 || undefined,
    line2: source.line2 || source.address_line2 || source.landmark || undefined,
    city: source.city || source.vtc || source.district || undefined,
    state: source.state || undefined,
    pincode: source.pincode || source.pin || source.pin_code || undefined,
  };
}

/**
 * Identity fields — primarily from front OCR / QR fallback.
 * @param {object} mapped - smartOcrMapper output
 * @param {object} [raw] - optional raw Cashfree body for QR/doc pickers
 */
function buildIdentityExtracted(mapped, raw = null) {
  const doc = raw
    ? raw.document_fields || raw.documentFields || raw.data?.document_fields || {}
    : {};
  const qr = raw ? raw.qr_details || raw.qrDetails || raw.data?.qr_details || {} : {};

  const aadhaarLast4 =
    lastFourFromMasked(mapped?.maskedAadhaar) ||
    (qr.aadhaar_last_four_digit && String(qr.aadhaar_last_four_digit).slice(-4)) ||
    (doc.aadhaar_last_four_digit && String(doc.aadhaar_last_four_digit).slice(-4)) ||
    null;

  return {
    name: pickName(doc, qr) || mapped?.name || null,
    dob: pickDob(doc, qr, mapped),
    gender: pickGender(doc, qr) || mapped?.gender || null,
    aadhaarLast4,
  };
}

/**
 * Address — primarily from back OCR / QR.
 */
function buildAddressExtracted(mapped, raw = null) {
  const doc = raw
    ? raw.document_fields || raw.documentFields || raw.data?.document_fields || {}
    : {};
  const qr = raw ? raw.qr_details || raw.qrDetails || raw.data?.qr_details || {} : {};

  const addr =
    normalizeAddress(mapped?.address) ||
    normalizeAddress(doc.address) ||
    normalizeAddress(qr.address) ||
    normalizeAddress(qr.structured_address);

  return addr;
}

/**
 * @param {object} mapped
 * @param {object} [raw]
 * @param {'front'|'back'} side
 */
function buildSideExtracted(mapped, raw, side) {
  const identity = buildIdentityExtracted(mapped, raw);
  const address = buildAddressExtracted(mapped, raw);
  const qrStatus = mapped?.qrValidationStatus || null;

  if (side === 'front') {
    return {
      ...identity,
      qrStatus,
    };
  }

  return {
    address: address || undefined,
    aadhaarLast4: identity.aadhaarLast4 || undefined,
    qrStatus,
  };
}

/**
 * Merge front + back extracted blobs for finalize and API.
 */
function mergeOcrExtracted(frontExtracted = {}, backExtracted = {}) {
  const merged = {
    name: frontExtracted.name || backExtracted.name || null,
    dob: frontExtracted.dob || backExtracted.dob || null,
    gender: frontExtracted.gender || backExtracted.gender || null,
    aadhaarLast4: frontExtracted.aadhaarLast4 || backExtracted.aadhaarLast4 || null,
    address: backExtracted.address || frontExtracted.address || null,
    qrStatus: backExtracted.qrStatus || frontExtracted.qrStatus || null,
  };

  Object.keys(merged).forEach((k) => {
    if (merged[k] == null || merged[k] === '') delete merged[k];
  });

  return merged;
}

/**
 * Map merged extracted → mapper-like shape for finalizeOcrSession.
 */
function mergedToVerifiedFields(merged, maskedAadhaar) {
  const yearFromDob = merged.dob && /^\d{4}/.test(merged.dob)
    ? merged.dob.slice(0, 4)
    : /^\d{4}$/.test(String(merged.dob || ''))
      ? String(merged.dob)
      : undefined;

  return {
    name: merged.name || undefined,
    dob: merged.dob || undefined,
    yearOfBirth: yearFromDob,
    gender: merged.gender || undefined,
    address: merged.address || undefined,
    maskedAadhaar,
    aadhaarLast4: merged.aadhaarLast4 || lastFourFromMasked(maskedAadhaar) || undefined,
  };
}

/** Strip empty keys for public API */
function toPublicExtracted(merged) {
  if (!merged || typeof merged !== 'object') return undefined;
  const out = { ...merged };
  Object.keys(out).forEach((k) => {
    if (out[k] == null || out[k] === '') delete out[k];
  });
  return Object.keys(out).length ? out : undefined;
}

module.exports = {
  buildIdentityExtracted,
  buildAddressExtracted,
  buildSideExtracted,
  mergeOcrExtracted,
  mergedToVerifiedFields,
  toPublicExtracted,
  lastFourFromMasked,
  normalizeAddress,
};
