/**
 * Shared OCR session finalization (idempotent).
 * Mirrors digilockerCompletionService pattern.
 */

const Verification = require('../models/Verification');
const KycSession = require('../models/KycSession');
const userService = require('./userService');
const logger = require('../config/logger');
const { buildPersistableOcrMetadata } = require('../utils/sanitizeCashfreeResponse');
const { computeVisibleToUserAt } = require('../config/ocrReview.config');
const { redactForLog } = require('../utils/loggerRedaction');

async function returnAlreadyCompleted(userId) {
  const existing = await Verification.findByUserIdAndType(userId, 'aadhaar');
  const session = await KycSession.findOne({
    userId,
    sessionType: 'aadhaar_ocr',
    internalStatus: 'completed',
  }).sort({ createdAt: -1 });

  return {
    success: true,
    alreadyCompleted: true,
    visibleStatus: session?.visibleStatus || 'verified',
    maskedAadhaar: existing?.maskedAadhaar,
    visibleToUserAt: session?.visibleToUserAt || existing?.ocrMetadata?.visibleToUserAt,
  };
}

/**
 * @param {object} params
 * @param {string} params.verificationId - KycSession.verification_id
 * @param {string} params.userId
 * @param {object} params.mapped - merged front/back mapped OCR
 * @param {object} params.session - mongoose KycSession doc
 */
async function finalizeOcrSession({ verificationId, userId, mapped, session }) {
  if (!verificationId || !userId || !session) {
    return { success: false, error: 'Missing required finalize parameters' };
  }

  if (session.internalStatus === 'completed' && session.visibleStatus === 'verified') {
    return returnAlreadyCompleted(userId);
  }

  const claimed = await KycSession.findOneAndUpdate(
    {
      verification_id: verificationId,
      userId,
      internalStatus: { $in: ['processing', 'completing'] },
    },
    { $set: { internalStatus: 'completing', status: 'completing' } },
    { new: true }
  );

  if (!claimed) {
    logger.info('finalizeOcrSession: idempotency race', redactForLog({ verificationId, userId }));
    return returnAlreadyCompleted(userId);
  }

  const now = new Date();
  const visibleToUserAt = computeVisibleToUserAt(now);
  const persistMeta = buildPersistableOcrMetadata(mapped);
  const maskedAadhaar = mapped.maskedAadhaar || session.ocr?.maskedAadhaar;

  const dob = mapped.dob ? String(mapped.dob).trim() : undefined;
  const yearOfBirth =
    mapped.yearOfBirth ||
    (dob && /^\d{4}/.test(dob) ? dob.slice(0, 4) : undefined) ||
    undefined;

  const verifiedData = {
    name: mapped.name || undefined,
    dob: dob || undefined,
    yearOfBirth: yearOfBirth || undefined,
    gender: mapped.gender || undefined,
    address: mapped.address || undefined,
  };

  let verification = await Verification.findByUserIdAndType(userId, 'aadhaar');
  const verificationPayload = {
    userId,
    type: 'aadhaar',
    status: 'under_review',
    verificationMethod: 'aadhaar_ocr',
    provider: 'cashfree',
    verificationSource: 'self_service_api',
    maskedAadhaar,
    verifiedData,
    kycSessionId: session._id,
    initiatedAt: session.createdAt,
    ocrMetadata: {
      ...persistMeta,
      visibleToUserAt,
      internalCompletedAt: now,
    },
    consent: {
      given: true,
      givenAt: session.createdAt,
      consentVersion: 'v1.0',
      consentText: 'User consented to Aadhaar verification via document OCR',
    },
    auditLog: [
      {
        action: 'verified',
        performedBy: userId,
        performedAt: now,
        metadata: { method: 'aadhaar_ocr', verificationId, note: 'internal_complete_pending_review' },
      },
    ],
  };

  if (verification) {
    Object.assign(verification, verificationPayload);
    await verification.save();
  } else {
    verification = await Verification.create(verificationPayload);
  }

  claimed.internalStatus = 'completed';
  claimed.status = 'completed';
  claimed.visibleStatus = 'under_review';
  claimed.visibleToUserAt = visibleToUserAt;
  claimed.ocr = {
    ...claimed.ocr,
    maskedAadhaar,
    merged: session.ocr?.merged || claimed.ocr?.merged,
    frontExtracted: session.ocr?.frontExtracted || claimed.ocr?.frontExtracted,
    backExtracted: session.ocr?.backExtracted || claimed.ocr?.backExtracted,
    fraudSummary: persistMeta?.fraudSummary,
    qualitySummary: persistMeta?.qualitySummary,
    qrValidationStatus: persistMeta?.qrValidationStatus,
  };
  await claimed.save();

  logger.info('OCR session finalized (internal)', redactForLog({
    verificationId,
    userId,
    visibleToUserAt: visibleToUserAt.toISOString(),
  }));

  return {
    success: true,
    alreadyCompleted: false,
    visibleStatus: 'under_review',
    visibleToUserAt: visibleToUserAt.toISOString(),
    maskedAadhaar,
  };
}

module.exports = { finalizeOcrSession, returnAlreadyCompleted };
