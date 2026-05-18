/**
 * Mutual exclusion between DigiLocker and Aadhaar OCR active sessions.
 */

const KycSession = require('../models/KycSession');
const {
  ACTIVE_DIGILOCKER_STATUSES,
} = require('../utils/validationHelpers');

async function assertNoActiveDigilockerSession(userId) {
  const active = await KycSession.findActiveByUserId(
    userId,
    'digilocker',
    ACTIVE_DIGILOCKER_STATUSES
  );
  if (active) {
    const err = new Error('An active DigiLocker verification is in progress');
    err.code = 'DIGILOCKER_SESSION_ACTIVE';
    err.statusCode = 409;
    throw err;
  }
}

async function assertNoActiveOcrSession(userId) {
  const active = await KycSession.findOne({
    userId,
    sessionType: 'aadhaar_ocr',
    $or: [
      { internalStatus: { $in: ['awaiting_front', 'awaiting_back', 'processing', 'completing'] } },
      { internalStatus: 'completed', visibleStatus: 'under_review' },
      { internalStatus: 'failed', visibleStatus: 'under_review' },
    ],
  }).sort({ createdAt: -1 });

  if (active) {
    const err = new Error('An active Aadhaar OCR verification is in progress');
    err.code = 'OCR_SESSION_ACTIVE';
    err.statusCode = 409;
    throw err;
  }
}

module.exports = {
  assertNoActiveDigilockerSession,
  assertNoActiveOcrSession,
  ACTIVE_DIGILOCKER_STATUSES,
};
