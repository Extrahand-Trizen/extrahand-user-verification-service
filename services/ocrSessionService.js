/**

 * Aadhaar OCR session orchestration — routes delegate here (thin controllers).

 */



const crypto = require('crypto');

const KycSession = require('../models/KycSession');

const Verification = require('../models/Verification');

const userService = require('./userService');

const smartOcrService = require('./smartOcrService');

const kycVaultStorage = require('./kycVaultStorage');

const { finalizeOcrSession } = require('./finalizeOcrSession');

const { resolveSessionVisibility } = require('./reviewVisibilityService');

const {

  validateOcrMappedResult,

  validateFrontBackConsistency,

} = require('./ocrValidationService');

const { assertNoActiveDigilockerSession } = require('./sessionExclusionService');

const { generateOcrStorageKey, extensionFromMime } = require('../utils/storageKeyGenerator');

const { validateOcrImageUpload, buildCashfreeOcrVerificationId } = require('../utils/validationHelpers');

const { OCR_REVIEW_CONFIG, computeVisibleFailureAt } = require('../config/ocrReview.config');

const { redactForLog } = require('../utils/loggerRedaction');

const {
  buildSideExtracted,
  mergeOcrExtracted,
  mergedToVerifiedFields,
  toPublicExtracted,
} = require('../utils/ocrExtractedData');

const logger = require('../config/logger');



function buildPublicStatusPayload(session) {

  const showFailure = session.visibleStatus === 'failed';

  const extracted = toPublicExtracted(
    session.ocr?.merged ||
      mergeOcrExtracted(session.ocr?.frontExtracted, session.ocr?.backExtracted),
  );

  return {

    verification_id: session.verification_id,

    visibleStatus: session.visibleStatus,

    visibleToUserAt: session.visibleStatus === 'under_review' ? session.visibleToUserAt || null : null,

    requiresFront: session.internalStatus === 'awaiting_front',

    requiresBack: session.internalStatus === 'awaiting_back',

    maskedAadhaar:

      session.visibleStatus === 'verified' ? session.ocr?.maskedAadhaar : undefined,

    failureReason: showFailure ? session.failureReason : undefined,

    extracted,

  };

}



async function resolveAndBuildStatus(session) {

  const resolved = await resolveSessionVisibility(session);

  return buildPublicStatusPayload(resolved);

}



async function ensureNotAlreadyVerified(userId) {

  const aadhaarVerification = await Verification.findByUserIdAndType(userId, 'aadhaar');

  if (aadhaarVerification?.status === 'verified') {

    return {

      alreadyVerified: true,

      maskedAadhaar: aadhaarVerification.maskedAadhaar,

      verifiedAt: aadhaarVerification.verifiedAt,

    };

  }

  try {

    const userProfile = await userService.getUserProfile(userId);

    const profile = userProfile.data?.profile || userProfile.data;

    if (userProfile.success && profile?.isAadhaarVerified === true) {

      return {

        alreadyVerified: true,

        maskedAadhaar: profile.maskedAadhaar,

        verifiedAt: profile.aadhaarVerifiedAt,

      };

    }

  } catch {

    // non-blocking

  }

  return null;

}



/**

 * POST initiate

 */

async function initiateSession(userId, { consentGiven }) {

  if (!consentGiven) {

    const err = new Error('User consent is required');

    err.statusCode = 400;

    err.code = 'CONSENT_REQUIRED';

    throw err;

  }



  const verified = await ensureNotAlreadyVerified(userId);

  if (verified) return { alreadyVerified: true, ...verified };



  await assertNoActiveDigilockerSession(userId);



  const existing = await KycSession.findOne({

    userId,

    sessionType: 'aadhaar_ocr',

    $or: [

      { internalStatus: { $in: ['awaiting_front', 'awaiting_back', 'processing', 'completing'] } },

      { internalStatus: 'completed', visibleStatus: 'under_review' },

      { internalStatus: 'failed', visibleStatus: 'under_review' },

    ],

  }).sort({ createdAt: -1 });



  if (existing) {

    const payload = await resolveAndBuildStatus(existing);

    return { session: existing, resumed: true, ...payload };

  }



  const verificationId = `eh_${crypto.randomUUID().replace(/-/g, '')}`;



  const session = await KycSession.create({

    verification_id: verificationId,

    userId,

    sessionType: 'aadhaar_ocr',

    status: 'awaiting_front',

    internalStatus: 'awaiting_front',

    visibleStatus: 'pending',

  });



  logger.info('OCR session initiated', redactForLog({ userId, verificationId }));



  return {

    session,

    resumed: false,

    ...(await resolveAndBuildStatus(session)),

  };

}



async function loadUserSession(verificationId, userId) {

  const session = await KycSession.findByVerificationId(verificationId);

  if (!session || session.userId !== userId || session.sessionType !== 'aadhaar_ocr') {

    const err = new Error('OCR session not found');

    err.statusCode = 404;

    err.code = 'SESSION_NOT_FOUND';

    throw err;

  }

  return session;

}



function schedulePurgeAt(success) {

  const now = Date.now();

  if (success) {

    return new Date(now + OCR_REVIEW_CONFIG.imageRetentionHoursSuccess * 60 * 60 * 1000);

  }

  return new Date(now + OCR_REVIEW_CONFIG.imageRetentionMinutesFailure * 60 * 1000);

}



/**

 * Internal failure — user still sees under_review until visibleFailureAt (lazy resolve).

 */

async function failSession(session, reason, code) {

  session.internalStatus = 'failed';

  session.status = 'failed';

  session.visibleStatus = 'under_review';

  session.visibleFailureAt = computeVisibleFailureAt();

  session.failureReason = reason;

  session.ocr = {

    ...session.ocr,

    purgeScheduledAt: schedulePurgeAt(false),

  };

  await session.save();



  return { accepted: false, reason, code, session };

}



/**

 * Upload front or back image + run OCR.

 */

async function uploadSide(userId, verificationId, side, { buffer, mimetype, size }) {

  const uploadCheck = validateOcrImageUpload({ buffer, mimetype, size });

  if (!uploadCheck.valid) {

    const err = new Error(uploadCheck.message);

    err.statusCode = 400;

    err.code = uploadCheck.code;

    throw err;

  }



  const session = await loadUserSession(verificationId, userId);



  const expectedStatus = side === 'back' ? 'awaiting_back' : 'awaiting_front';

  if (session.internalStatus !== expectedStatus) {

    const err = new Error(

      side === 'back'

        ? 'Front image must be uploaded first'

        : 'Invalid session state for front upload'

    );

    err.statusCode = 409;

    err.code = 'INVALID_SESSION_STATE';

    throw err;

  }



  const ext = extensionFromMime(mimetype);

  const storageKey = generateOcrStorageKey({

    userId,

    sessionId: session.verification_id,

    side,

    extension: ext,

  });



  await kycVaultStorage.putObject(storageKey, buffer, mimetype);



  const cfVerificationId = buildCashfreeOcrVerificationId(`ocr${side[0]}`);

  const { mapped, raw } = await smartOcrService.submitAadhaarOcr({

    verificationId: cfVerificationId,

    fileBuffer: buffer,

    mimeType: mimetype,

    side,

  });

  const sideExtracted = buildSideExtracted(mapped, raw, side);



  const validation = validateOcrMappedResult(mapped);

  if (!validation.accepted) {

    await kycVaultStorage.deleteObject(storageKey);

    await failSession(session, validation.rejectReason, validation.code);

    const refreshed = await KycSession.findByVerificationId(verificationId);

    return {

      ...(await resolveAndBuildStatus(refreshed)),

      side,

      softFailure: true,

      code: validation.code,

    };

  }



  const now = new Date();



  if (side === 'front') {

    const frontExtracted = sideExtracted;

    session.ocr = {

      ...session.ocr,

      frontImageKey: storageKey,

      frontUploadedAt: now,

      frontOcrAt: now,

      cashfreeVerificationIdFront: cfVerificationId,

      fraudSummary: mapped.fraudSummary,

      qualitySummary: mapped.qualitySummary,

      qrValidationStatus: mapped.qrValidationStatus,

      maskedAadhaar: mapped.maskedAadhaar || session.ocr?.maskedAadhaar,

      frontExtracted,

    };

    session.internalStatus = 'awaiting_back';

    session.status = 'awaiting_back';

    session.visibleStatus = 'pending';

    await session.save();



    return {

      ...(await resolveAndBuildStatus(session)),

      side: 'front',

      warnings: validation.warnings,

      extracted: toPublicExtracted(frontExtracted),

    };

  }



  const consistency = validateFrontBackConsistency(

    { maskedAadhaar: session.ocr?.maskedAadhaar },

    mapped

  );

  if (!consistency.accepted) {

    await kycVaultStorage.deleteObject(storageKey);

    await failSession(session, consistency.rejectReason, consistency.code);

    const refreshed = await KycSession.findByVerificationId(verificationId);

    return {

      ...(await resolveAndBuildStatus(refreshed)),

      side: 'back',

      softFailure: true,

      code: consistency.code,

    };

  }



  session.internalStatus = 'processing';

  session.status = 'processing';

  const backExtracted = sideExtracted;

  const merged = mergeOcrExtracted(session.ocr?.frontExtracted, backExtracted);

  const maskedAadhaar = mapped.maskedAadhaar || session.ocr?.maskedAadhaar;

  session.ocr = {

    ...session.ocr,

    backImageKey: storageKey,

    backUploadedAt: now,

    backOcrAt: now,

    cashfreeVerificationIdBack: cfVerificationId,

    maskedAadhaar,

    backExtracted,

    merged,

    purgeScheduledAt: schedulePurgeAt(true),

  };

  await session.save();



  const mergedMapped = {

    ...mapped,

    ...mergedToVerifiedFields(merged, maskedAadhaar),

    fraudSummary: { ...(session.ocr?.fraudSummary || {}), ...mapped.fraudSummary },

    qualitySummary: { ...(session.ocr?.qualitySummary || {}), ...mapped.qualitySummary },

    qrValidationStatus: mapped.qrValidationStatus,

  };



  await finalizeOcrSession({

    verificationId,

    userId,

    mapped: mergedMapped,

    session,

  });



  const refreshed = await KycSession.findByVerificationId(verificationId);

  const statusPayload = await resolveAndBuildStatus(refreshed);



  return {

    ...statusPayload,

    side: 'back',

    warnings: validation.warnings,

    extracted: toPublicExtracted(merged),

  };

}



/**

 * GET status — lazy visibility resolution (primary path; minimal polling needed).

 */

async function getStatus(userId, verificationId) {

  let session;



  if (!verificationId) {

    session = await KycSession.findOne({

      userId,

      sessionType: 'aadhaar_ocr',

    }).sort({ createdAt: -1 });

    if (!session) {

      const err = new Error('No OCR session found');

      err.statusCode = 404;

      err.code = 'SESSION_NOT_FOUND';

      throw err;

    }

  } else {

    session = await loadUserSession(verificationId, userId);

  }



  return resolveAndBuildStatus(session);

}



async function cancelSession(userId, verificationId) {

  const session = await loadUserSession(verificationId, userId);

  if (['completed', 'cancelled', 'expired'].includes(session.internalStatus)) {

    if (session.visibleStatus === 'under_review') {

      return resolveAndBuildStatus(session);

    }

    return buildPublicStatusPayload(session);

  }



  session.internalStatus = 'cancelled';

  session.status = 'cancelled';

  session.visibleStatus = 'cancelled';

  session.ocr = {

    ...session.ocr,

    purgeScheduledAt: schedulePurgeAt(false),

  };

  await session.save();



  await kycVaultStorage.deleteObjects([

    session.ocr?.frontImageKey,

    session.ocr?.backImageKey,

  ]);



  return buildPublicStatusPayload(session);

}



module.exports = {

  initiateSession,

  uploadSide,

  getStatus,

  cancelSession,

  buildPublicStatusPayload,

  resolveAndBuildStatus,

};


