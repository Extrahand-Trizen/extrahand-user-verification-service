const Verification = require('../models/Verification');
const KycSession = require('../models/KycSession');
const digilockerService = require('./digilockerService');
const userService = require('./userService');
const logger = require('../config/logger');
const { maskAadhaar } = require('../utils/validation');
const {
  assertAadhaarFingerprintNotRegisteredToOtherUser,
  applyFingerprintToTarget,
  buildAadhaarFingerprintFromOcr,
  normalizeAadhaarDigits,
  AadhaarDuplicateError,
} = require('../utils/aadhaarHash');

/**
 * Shared DigiLocker session finalization logic.
 * Used by both the webhook handler and the /complete API route
 * to avoid code divergence.
 *
 * @param {object} params
 * @param {string} params.verificationId - Cashfree verification_id
 * @param {string} params.userId - ExtraHand user UID
 * @param {string} params.completionSource - 'app_callback' | 'webhook' | 'reconcile_job'
 * @returns {Promise<{success: boolean, alreadyCompleted?: boolean, maskedAadhaar?: string, verifiedData?: object, error?: string}>}
 */
async function returnAlreadyCompleted(userId) {
  const existing = await Verification.findByUserIdAndType(userId, 'aadhaar');
  return {
    success: true,
    alreadyCompleted: true,
    maskedAadhaar: existing?.maskedAadhaar,
    verifiedData: existing?.verifiedData,
    verifiedAt: existing?.verifiedAt,
  };
}

async function finalizeDigilockerSession({ verificationId, userId, completionSource = 'app_callback' }) {
  if (!verificationId || !userId) {
    return { success: false, error: 'Missing verificationId or userId' };
  }

  const session = await KycSession.findByVerificationId(verificationId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status === 'completed') {
    return returnAlreadyCompleted(userId);
  }

  const docResult = await digilockerService.getDocument(verificationId, 'AADHAAR');

  if (docResult?.status !== 'SUCCESS') {
    const reason = docResult?.status === 'AADHAAR_NOT_LINKED'
      ? 'Aadhaar is not linked in DigiLocker. Please link Aadhaar and retry.'
      : docResult?.message || docResult?.status || 'Document not ready yet';

    if (completionSource === 'app_callback') {
      session.status = 'failed';
      session.failureReason = reason;
      await session.save();
    }
    return { success: false, error: reason, code: docResult?.status || 'DOCUMENT_FETCH_FAILED' };
  }

  // Atomic idempotency guard: claim the session for completion.
  // If two callers (webhook + app_callback) race past the initial check above,
  // only the one whose findOneAndUpdate matches a non-completed session wins.
  const claimed = await KycSession.findOneAndUpdate(
    { verificationId, status: { $ne: 'completed' } },
    { $set: { status: 'completing' } },
    { new: true },
  );

  if (!claimed) {
    logger.info('finalizeDigilockerSession: lost idempotency race (another caller completed first)', {
      verificationId, userId, completionSource,
    });
    return returnAlreadyCompleted(userId);
  }

  const now = new Date();
  const uidRaw = docResult.uid || docResult.aadhaar_number || docResult.masked_aadhaar || '';
  const aadhaarDigits = normalizeAadhaarDigits(uidRaw);
  let maskedAadhaar = 'XXXX XXXX XXXX';

  if (aadhaarDigits) {
    maskedAadhaar = maskAadhaar(aadhaarDigits);
  } else if (uidRaw) {
    maskedAadhaar = String(uidRaw);
  }

  const dob =
    docResult.dob || docResult.date_of_birth || docResult.dateOfBirth || undefined;
  const fingerprint = buildAadhaarFingerprintFromOcr({
    mapped: {
      _omit: { uid: uidRaw },
      name: docResult.name,
      dob: dob ? String(dob).trim() : undefined,
      maskedAadhaar,
    },
    merged: {
      name: docResult.name,
      dob: dob ? String(dob).trim() : undefined,
      maskedAadhaar,
    },
    maskedAadhaar,
  });

  try {
    await assertAadhaarFingerprintNotRegisteredToOtherUser(fingerprint, userId);
  } catch (error) {
    if (error instanceof AadhaarDuplicateError) {
      claimed.status = 'failed';
      claimed.failureReason = error.message;
      await claimed.save();
      return { success: false, error: error.message, code: error.code };
    }
    throw error;
  }

  const verifiedData = {
    name: docResult.name,
    dob: dob ? String(dob).trim() : undefined,
    yearOfBirth: docResult.year_of_birth,
    gender: docResult.gender,
    careOf: docResult.care_of,
    photoLink: docResult.photo_link,
    address: docResult.split_address,
  };

  let verification = await Verification.findByUserIdAndType(userId, 'aadhaar');
  const verificationPayload = {
    userId,
    type: 'aadhaar',
    status: 'verified',
    provider: 'cashfree',
    verificationSource: completionSource,
    maskedAadhaar,
    verifiedData,
    verifiedAt: now,
    kycSessionId: session._id,
    consent: {
      given: true,
      givenAt: session.createdAt,
      consentVersion: 'v1.0',
      consentText: 'User consented to Aadhaar verification via DigiLocker',
    },
    auditLog: [{
      action: 'verified',
      performedBy: userId,
      performedAt: now,
      metadata: { method: `digilocker_${completionSource}`, verificationId },
    }],
  };

  if (verification) {
    Object.assign(verification, verificationPayload);
    applyFingerprintToTarget(verification, fingerprint);
    await verification.save();
  } else {
    verification = await Verification.create(
      applyFingerprintToTarget({ ...verificationPayload }, fingerprint),
    );
  }

  // Transition from transient 'completing' to final 'completed'.
  claimed.status = 'completed';
  claimed.completionSource = completionSource;
  claimed.consentExpiresAt = claimed.documentConsentValidity || claimed.consentExpiresAt;
  await claimed.save();

  try {
    await userService.updateAadhaarVerificationStatus(userId, {
      isAadhaarVerified: true,
      aadhaarVerifiedAt: now.toISOString(),
      maskedAadhaar,
      verifiedData: {
        name: verifiedData.name,
        dob: verifiedData.dob,
        gender: verifiedData.gender,
        yearOfBirth: verifiedData.yearOfBirth,
      },
    });
  } catch (error) {
    logger.error('finalizeDigilockerSession: user-service sync failed (non-blocking)', {
      verificationId,
      userId,
      completionSource,
      error: error?.message || error,
    });
  }

  logger.info('DigiLocker session finalized', { verificationId, userId, completionSource });

  return {
    success: true,
    alreadyCompleted: false,
    maskedAadhaar,
    verifiedData: {
      name: verifiedData.name,
      dob: verifiedData.dob,
      gender: verifiedData.gender,
      yearOfBirth: verifiedData.yearOfBirth,
    },
    verifiedAt: now.toISOString(),
  };
}

module.exports = { finalizeDigilockerSession };
