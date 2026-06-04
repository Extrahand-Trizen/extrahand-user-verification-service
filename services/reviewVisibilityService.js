/**

 * Centralized review visibility — lazy resolution (primary) + batch reconcile (secondary).

 * All transitions from under_review → verified/failed MUST go through this module.

 */



const KycSession = require('../models/KycSession');

const Verification = require('../models/Verification');

const userService = require('./userService');

const logger = require('../config/logger');

const { redactForLog } = require('../utils/loggerRedaction');
const {
  buildAadhaarFingerprintFromOcr,
  persistFingerprintOnVerifiedVerification,
} = require('../utils/aadhaarHash');

/**
 * Lazy transition: call on every status read (and after uploads).

 * @param {import('mongoose').Document} session

 * @returns {Promise<import('mongoose').Document>}

 */

async function resolveSessionVisibility(session) {

  if (!session || session.sessionType !== 'aadhaar_ocr') {

    return session;

  }



  const now = new Date();



  if (

    session.internalStatus === 'completed' &&

    session.visibleStatus === 'under_review' &&

    session.visibleToUserAt &&

    now >= new Date(session.visibleToUserAt)

  ) {

    return promoteToVisibleVerified(session);

  }



  if (

    session.internalStatus === 'failed' &&

    session.visibleStatus === 'under_review' &&

    session.visibleFailureAt &&

    now >= new Date(session.visibleFailureAt)

  ) {

    return promoteToVisibleFailed(session);

  }



  return session;

}



/**

 * Load session and apply lazy visibility resolution.

 */

async function resolveSessionVisibilityById(verificationId, userId) {

  const session = await KycSession.findByVerificationId(verificationId);

  if (!session || session.userId !== userId || session.sessionType !== 'aadhaar_ocr') {

    return null;

  }

  return resolveSessionVisibility(session);

}



/**

 * internalStatus completed → user sees verified + profile sync.

 */

/**
 * Push verified Aadhaar KYC state to user-service profile (isAadhaarVerified, maskedAadhaar, etc.)
 */
async function syncVerifiedProfileToUserService(session, verification, verifiedAt = new Date()) {
  const result = await userService.updateAadhaarVerificationStatus(session.userId, {
    isAadhaarVerified: true,
    aadhaarVerifiedAt: verifiedAt.toISOString(),
    maskedAadhaar: verification?.maskedAadhaar || session.ocr?.maskedAadhaar,
    verifiedData: {
      name: verification?.verifiedData?.name || session.ocr?.merged?.name,
      dob: verification?.verifiedData?.dob || session.ocr?.merged?.dob,
      gender: verification?.verifiedData?.gender || session.ocr?.merged?.gender,
      yearOfBirth: verification?.verifiedData?.yearOfBirth,
    },
  });

  if (!result.success) {
    throw new Error(result.error || 'User profile sync failed');
  }

  session.ocr = { ...(session.ocr || {}), profileSyncedAt: verifiedAt };
  await session.save();
  return result;
}

async function promoteToVisibleVerified(session) {

  const now = new Date();



  const updated = await KycSession.findOneAndUpdate(

    {

      _id: session._id,

      internalStatus: 'completed',

      visibleStatus: 'under_review',

    },

    { $set: { visibleStatus: 'verified' } },

    { new: true }

  );



  if (!updated) {

    return KycSession.findById(session._id);

  }



  const verification = await Verification.findByUserIdAndType(session.userId, 'aadhaar');

  if (verification && verification.status === 'under_review') {

    verification.status = 'verified';

    verification.verifiedAt = verification.verifiedAt || now;

    if (verification.ocrMetadata) {

      verification.ocrMetadata.userVisibleAt = now;

    }

    const fingerprint = buildAadhaarFingerprintFromOcr({
      merged: session.ocr?.merged,
      maskedAadhaar: verification.maskedAadhaar || session.ocr?.maskedAadhaar,
    });
    persistFingerprintOnVerifiedVerification(verification, fingerprint);

    await verification.save();

  }



  try {
    await syncVerifiedProfileToUserService(updated, verification, now);
  } catch (e) {
    logger.error('reviewVisibility: profile sync failed (non-blocking)', redactForLog({
      userId: session.userId,
      error: e.message,
    }));
  }



  logger.info('OCR lazy visibility: promoted to verified', redactForLog({

    verificationId: updated.verification_id,

    userId: updated.userId,

  }));



  return updated;

}



/**

 * internalStatus failed → user sees failed (after grace window).

 */

async function promoteToVisibleFailed(session) {

  const updated = await KycSession.findOneAndUpdate(

    {

      _id: session._id,

      internalStatus: 'failed',

      visibleStatus: 'under_review',

    },

    { $set: { visibleStatus: 'failed', status: 'failed' } },

    { new: true }

  );



  if (!updated) {

    return KycSession.findById(session._id);

  }



  const verification = await Verification.findByUserIdAndType(session.userId, 'aadhaar');

  if (verification && ['under_review', 'pending'].includes(verification.status)) {

    verification.status = 'failed';

    verification.failedAt = new Date();

    verification.failureReason = updated.failureReason || verification.failureReason;

    await verification.save();

  }



  // Failed OCR images are retained until ocrImagePurgeJob runs (see OCR_IMAGE_RETENTION_DAYS_FAILURE).

  logger.info('OCR lazy visibility: promoted to failed', redactForLog({

    verificationId: updated.verification_id,

    userId: updated.userId,

  }));



  return updated;

}



/**

 * Secondary safety net — reconcile stale under_review sessions (no aggressive polling required).

 */

async function processDueReviewVisibility() {

  const now = new Date();



  const dueSuccess = await KycSession.find({

    sessionType: 'aadhaar_ocr',

    internalStatus: 'completed',

    visibleStatus: 'under_review',

    visibleToUserAt: { $lte: now },

  }).limit(50);



  const dueFailure = await KycSession.find({

    sessionType: 'aadhaar_ocr',

    internalStatus: 'failed',

    visibleStatus: 'under_review',

    visibleFailureAt: { $lte: now },

  }).limit(50);



  let promoted = 0;



  for (const session of [...dueSuccess, ...dueFailure]) {

    const before = session.visibleStatus;

    await resolveSessionVisibility(session);

    const afterDoc = await KycSession.findById(session._id);

    if (afterDoc && afterDoc.visibleStatus !== before) {

      promoted += 1;

    }

  }



  if (promoted > 0) {

    logger.info('OCR review visibility batch reconcile', { promoted });

  }



  return { promoted };

}

/**
 * Retry profile sync for OCR sessions already visible as verified but never synced to user profile.
 */
async function retryPendingProfileSyncs(limit = 20) {
  const sessions = await KycSession.find({
    sessionType: 'aadhaar_ocr',
    visibleStatus: 'verified',
    'ocr.profileSyncedAt': { $exists: false },
  }).limit(limit);

  let synced = 0;
  let failed = 0;

  for (const session of sessions) {
    const verification = await Verification.findByUserIdAndType(session.userId, 'aadhaar');
    try {
      await syncVerifiedProfileToUserService(session, verification, session.verifiedAt || new Date());
      synced += 1;
      logger.info('OCR profile sync retry succeeded', redactForLog({
        userId: session.userId,
        verificationId: session.verification_id,
      }));
    } catch (e) {
      failed += 1;
      logger.error('OCR profile sync retry failed', redactForLog({
        userId: session.userId,
        verificationId: session.verification_id,
        error: e.message,
      }));
    }
  }

  return { checked: sessions.length, synced, failed };
}

module.exports = {

  resolveSessionVisibility,

  resolveSessionVisibilityById,

  promoteToVisibleVerified,

  promoteToVisibleFailed,

  processDueReviewVisibility,

  syncVerifiedProfileToUserService,

  retryPendingProfileSyncs,

};


