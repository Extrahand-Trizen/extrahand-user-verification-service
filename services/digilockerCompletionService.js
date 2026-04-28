const Verification = require('../models/Verification');
const KycSession = require('../models/KycSession');
const digilockerService = require('./digilockerService');
const userService = require('./userService');
const logger = require('../config/logger');

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
async function finalizeDigilockerSession({ verificationId, userId, completionSource = 'app_callback' }) {
  if (!verificationId || !userId) {
    return { success: false, error: 'Missing verificationId or userId' };
  }

  const session = await KycSession.findByVerificationId(verificationId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status === 'completed') {
    const existing = await Verification.findByUserIdAndType(userId, 'aadhaar');
    return {
      success: true,
      alreadyCompleted: true,
      maskedAadhaar: existing?.maskedAadhaar,
      verifiedData: existing?.verifiedData,
      verifiedAt: existing?.verifiedAt,
    };
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

  const now = new Date();
  const maskedAadhaar = docResult.uid || 'XXXX XXXX XXXX';
  const verifiedData = {
    name: docResult.name,
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
    await verification.save();
  } else {
    verification = await Verification.create(verificationPayload);
  }

  session.status = 'completed';
  session.consentExpiresAt = session.documentConsentValidity || session.consentExpiresAt;
  await session.save();

  try {
    await userService.updateAadhaarVerificationStatus(userId, {
      isAadhaarVerified: true,
      aadhaarVerifiedAt: now.toISOString(),
      maskedAadhaar,
      verifiedData: {
        name: verifiedData.name,
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
      gender: verifiedData.gender,
      yearOfBirth: verifiedData.yearOfBirth,
    },
    verifiedAt: now.toISOString(),
  };
}

module.exports = { finalizeDigilockerSession };
