const crypto = require('crypto');
const { cleanAadhaarNumber, isValidAadhaarFormat } = require('./validation');

const DUPLICATE_MESSAGE =
  'This Aadhaar is already used with another account. Please use your own Aadhaar card.';
const DUPLICATE_CODE = 'AADHAAR_ALREADY_REGISTERED';

/** Only completed Aadhaar verifications reserve an identity in the duplicate registry. */
const BLOCKING_AADHAAR_STATUSES = ['verified'];

function getAadhaarHashPepper() {
  return (
    process.env.AADHAAR_HASH_PEPPER ||
    process.env.SERVICE_AUTH_TOKEN ||
    'extrahand-aadhaar-hash-pepper'
  );
}

function normalizeAadhaarDigits(input) {
  if (input == null || input === '') return null;
  const cleaned = cleanAadhaarNumber(String(input));
  if (!isValidAadhaarFormat(cleaned)) return null;
  return cleaned;
}

function hashAadhaarDigits(digits12) {
  const normalized = normalizeAadhaarDigits(digits12);
  if (!normalized) return null;
  const pepper = getAadhaarHashPepper();
  return crypto.createHmac('sha256', pepper).update(`full:${normalized}`).digest('hex');
}

function hashAadhaarInput(input) {
  const digits = normalizeAadhaarDigits(input);
  if (!digits) return null;
  return hashAadhaarDigits(digits);
}

function normalizeIdentityName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeIdentityDob(dob) {
  const raw = String(dob || '').trim();
  if (!raw) return '';

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = raw.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  if (/^\d{4}$/.test(raw)) return raw;

  return raw.toLowerCase();
}

function extractLastFourFromSources(sources = {}) {
  const { maskedAadhaar, aadhaarLast4, mapped, raw, merged } = sources;

  const candidates = [
    aadhaarLast4,
    merged?.aadhaarLast4,
    mapped?.maskedAadhaar,
    mapped?._omit?.uid,
    maskedAadhaar,
    merged?.maskedAadhaar,
  ];

  const doc = raw?.document_fields || raw?.documentFields || raw?.data?.document_fields || {};
  const qr = raw?.qr_details || raw?.qrDetails || raw?.data?.qr_details || {};
  candidates.push(
    qr.aadhaar_last_four_digit,
    qr.aadhaar_last_four_digits,
    doc.aadhaar_last_four_digit,
  );

  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    const digits = String(candidate).replace(/\D/g, '').slice(-4);
    if (digits.length === 4) return digits;
  }

  return null;
}

/**
 * Extract full 12-digit Aadhaar from OCR mapper output (never persist raw value).
 */
function extractAadhaarDigitsFromOcr(mapped, raw) {
  const candidates = [];

  if (mapped?._omit?.uid) candidates.push(mapped._omit.uid);

  const doc = raw?.document_fields || raw?.documentFields || raw?.data?.document_fields || {};
  const qr = raw?.qr_details || raw?.qrDetails || raw?.data?.qr_details || {};

  if (doc.uid) candidates.push(doc.uid);
  if (doc.aadhaar_number) candidates.push(doc.aadhaar_number);
  if (doc.aadhaarNumber) candidates.push(doc.aadhaarNumber);
  if (qr.uid) candidates.push(qr.uid);

  for (const candidate of candidates) {
    const digits = normalizeAadhaarDigits(candidate);
    if (digits) return digits;
  }

  return null;
}

function buildAadhaarIdentityHash({ name, dob, last4 }) {
  const nameNorm = normalizeIdentityName(name);
  const dobNorm = normalizeIdentityDob(dob);
  const last = String(last4 || '').replace(/\D/g, '').slice(-4);
  if (!nameNorm || !dobNorm || last.length !== 4) return null;

  const pepper = getAadhaarHashPepper();
  const payload = `identity:${last}|${nameNorm}|${dobNorm}`;
  return crypto.createHmac('sha256', pepper).update(payload).digest('hex');
}

function buildAadhaarFingerprintFromOcr({ mapped, raw, merged, maskedAadhaar } = {}) {
  const digits12 = extractAadhaarDigitsFromOcr(mapped, raw);
  const aadhaarHash = digits12 ? hashAadhaarDigits(digits12) : null;

  const name =
    merged?.name ||
    mapped?.name ||
    raw?.document_fields?.name ||
    raw?.documentFields?.name ||
    raw?.qr_details?.name ||
    raw?.qrDetails?.name ||
    null;

  const dob =
    merged?.dob ||
    mapped?.dob ||
    raw?.document_fields?.dob ||
    raw?.documentFields?.dob ||
    raw?.qr_details?.dob ||
    raw?.qrDetails?.dob ||
    null;

  const aadhaarLast4 = extractLastFourFromSources({
    maskedAadhaar,
    mapped,
    raw,
    merged,
  });

  const identityNameNormalized = normalizeIdentityName(name);
  const identityDobNormalized = normalizeIdentityDob(dob);
  const aadhaarIdentityHash = buildAadhaarIdentityHash({
    name: identityNameNormalized,
    dob: identityDobNormalized,
    last4: aadhaarLast4,
  });

  return {
    aadhaarHash,
    aadhaarIdentityHash,
    aadhaarLast4,
    identityNameNormalized: identityNameNormalized || undefined,
    identityDobNormalized: identityDobNormalized || undefined,
  };
}

function buildAadhaarFingerprintFromVerification(verification) {
  if (!verification) return buildAadhaarFingerprintFromOcr({});

  const maskedAadhaar = verification.maskedAadhaar;
  const name = verification.verifiedData?.name;
  const dob = verification.verifiedData?.dob || verification.verifiedData?.yearOfBirth;

  const fingerprint = buildAadhaarFingerprintFromOcr({
    merged: {
      name,
      dob,
      aadhaarLast4: verification.aadhaarLast4,
      maskedAadhaar,
    },
    maskedAadhaar,
  });

  return {
    aadhaarHash: verification.aadhaarHash || fingerprint.aadhaarHash || null,
    aadhaarIdentityHash: verification.aadhaarIdentityHash || fingerprint.aadhaarIdentityHash || null,
    aadhaarLast4: verification.aadhaarLast4 || fingerprint.aadhaarLast4 || null,
    identityNameNormalized:
      verification.identityNameNormalized || fingerprint.identityNameNormalized || undefined,
    identityDobNormalized:
      verification.identityDobNormalized || fingerprint.identityDobNormalized || undefined,
  };
}

function applyFingerprintToTarget(target, fingerprint) {
  if (!target || !fingerprint) return target;

  if (fingerprint.aadhaarHash) target.aadhaarHash = fingerprint.aadhaarHash;
  if (fingerprint.aadhaarIdentityHash) target.aadhaarIdentityHash = fingerprint.aadhaarIdentityHash;
  if (fingerprint.aadhaarLast4) target.aadhaarLast4 = fingerprint.aadhaarLast4;
  if (fingerprint.identityNameNormalized) {
    target.identityNameNormalized = fingerprint.identityNameNormalized;
  }
  if (fingerprint.identityDobNormalized) {
    target.identityDobNormalized = fingerprint.identityDobNormalized;
  }

  return target;
}

/**
 * Persist fingerprint hashes on a Verification doc — call only when status becomes verified.
 */
function persistFingerprintOnVerifiedVerification(verification, fingerprint) {
  if (!verification || !fingerprint) return verification;
  return applyFingerprintToTarget(verification, fingerprint);
}

class AadhaarDuplicateError extends Error {
  constructor(message = DUPLICATE_MESSAGE) {
    super(message);
    this.name = 'AadhaarDuplicateError';
    this.statusCode = 409;
    this.code = DUPLICATE_CODE;
  }
}

async function findAadhaarRegisteredToOtherUser(fingerprint, excludeUserId) {
  if (!fingerprint) return null;

  const Verification = require('../models/Verification');
  const baseQuery = {
    type: 'aadhaar',
    status: { $in: BLOCKING_AADHAAR_STATUSES },
    userId: { $ne: excludeUserId },
  };

  const orConditions = [];
  if (fingerprint.aadhaarHash) {
    orConditions.push({ aadhaarHash: fingerprint.aadhaarHash });
  }
  if (fingerprint.aadhaarIdentityHash) {
    orConditions.push({ aadhaarIdentityHash: fingerprint.aadhaarIdentityHash });
  }

  if (orConditions.length > 0) {
    const direct = await Verification.findOne({
      ...baseQuery,
      $or: orConditions,
    })
      .select('userId status')
      .lean();
    if (direct) return direct;
  }

  const { aadhaarLast4, identityNameNormalized, identityDobNormalized, aadhaarIdentityHash } =
    fingerprint;

  if (!aadhaarLast4 || !identityNameNormalized || !identityDobNormalized || !aadhaarIdentityHash) {
    return null;
  }

  const legacyCandidates = await Verification.find({
    ...baseQuery,
    $or: [{ aadhaarLast4 }, { maskedAadhaar: new RegExp(`${aadhaarLast4}$`) }],
  })
    .limit(25)
    .lean();

  for (const candidate of legacyCandidates) {
    const candidateFingerprint = buildAadhaarFingerprintFromVerification(candidate);
    if (
      candidateFingerprint.aadhaarIdentityHash &&
      candidateFingerprint.aadhaarIdentityHash === aadhaarIdentityHash
    ) {
      return candidate;
    }

    if (
      candidateFingerprint.aadhaarHash &&
      fingerprint.aadhaarHash &&
      candidateFingerprint.aadhaarHash === fingerprint.aadhaarHash
    ) {
      return candidate;
    }
  }

  return null;
}

/**
 * Hash input and throw if another account already registered this Aadhaar.
 * @returns {object|null} fingerprint when computed
 */
async function assertAadhaarNotRegisteredToOtherUser(aadhaarInput, excludeUserId) {
  const fingerprint = buildAadhaarFingerprintFromOcr({
    mapped: { _omit: { uid: aadhaarInput } },
  });

  if (!fingerprint.aadhaarHash && !fingerprint.aadhaarIdentityHash) {
    return null;
  }

  const existing = await findAadhaarRegisteredToOtherUser(fingerprint, excludeUserId);
  if (existing) {
    throw new AadhaarDuplicateError();
  }

  return fingerprint;
}

async function checkDuplicateAadhaarFingerprint(fingerprint, excludeUserId) {
  if (!fingerprint?.aadhaarHash && !fingerprint?.aadhaarIdentityHash) {
    return false;
  }

  const existing = await findAadhaarRegisteredToOtherUser(fingerprint, excludeUserId);
  if (existing) {
    throw new AadhaarDuplicateError();
  }

  return true;
}

async function assertAadhaarFingerprintNotRegisteredToOtherUser(fingerprint, excludeUserId) {
  if (!fingerprint?.aadhaarHash && !fingerprint?.aadhaarIdentityHash) {
    const err = new AadhaarDuplicateError(
      'Unable to verify Aadhaar uniqueness. Please retake clear photos of your Aadhaar card.',
    );
    err.code = 'AADHAAR_FINGERPRINT_MISSING';
    err.statusCode = 422;
    throw err;
  }

  return checkDuplicateAadhaarFingerprint(fingerprint, excludeUserId);
}

/** @deprecated use assertAadhaarFingerprintNotRegisteredToOtherUser */
async function assertAadhaarHashNotRegisteredToOtherUser(aadhaarHash, excludeUserId) {
  return assertAadhaarFingerprintNotRegisteredToOtherUser({ aadhaarHash }, excludeUserId);
}

module.exports = {
  DUPLICATE_MESSAGE,
  DUPLICATE_CODE,
  BLOCKING_AADHAAR_STATUSES,
  normalizeAadhaarDigits,
  normalizeIdentityName,
  normalizeIdentityDob,
  hashAadhaarDigits,
  hashAadhaarInput,
  extractAadhaarDigitsFromOcr,
  extractLastFourFromSources,
  buildAadhaarIdentityHash,
  buildAadhaarFingerprintFromOcr,
  buildAadhaarFingerprintFromVerification,
  applyFingerprintToTarget,
  persistFingerprintOnVerifiedVerification,
  AadhaarDuplicateError,
  findAadhaarRegisteredToOtherUser,
  checkDuplicateAadhaarFingerprint,
  assertAadhaarNotRegisteredToOtherUser,
  assertAadhaarFingerprintNotRegisteredToOtherUser,
  assertAadhaarHashNotRegisteredToOtherUser,
};
