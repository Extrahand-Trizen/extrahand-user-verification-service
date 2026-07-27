/**

 * Centralized review visibility — lazy resolution (primary) + batch reconcile (secondary).

 * All transitions from under_review → verified/failed MUST go through this module.

 */



const KycSession = require('../models/KycSession');

const Verification = require('../models/Verification');

const userService = require('./userService');

const kycVaultStorage = require('./kycVaultStorage');

const logger = require('../config/logger');

const { redactForLog } = require('../utils/loggerRedaction');



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

    await verification.save();

  }



  try {

    await userService.updateAadhaarVerificationStatus(session.userId, {

      isAadhaarVerified: true,

      aadhaarVerifiedAt: now.toISOString(),

      maskedAadhaar: verification?.maskedAadhaar || updated.ocr?.maskedAadhaar,

      verifiedData: {

        name: verification?.verifiedData?.name,

        dob: verification?.verifiedData?.dob,

        gender: verification?.verifiedData?.gender,

        yearOfBirth: verification?.verifiedData?.yearOfBirth,

      },

    });

    updated.ocr = { ...(updated.ocr || {}), profileSyncedAt: now };

    await updated.save();

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



  const keys = [updated.ocr?.frontImageKey, updated.ocr?.backImageKey].filter(Boolean);

  await kycVaultStorage.deleteObjects(keys);



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



module.exports = {

  resolveSessionVisibility,

  resolveSessionVisibilityById,

  promoteToVisibleVerified,

  promoteToVisibleFailed,

  processDueReviewVisibility,

};


