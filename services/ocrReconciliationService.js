/**
 * Reconcile stuck OCR sessions and profile sync gaps.
 */

const KycSession = require('../models/KycSession');
const Verification = require('../models/Verification');
const { processDueReviewVisibility } = require('./reviewVisibilityService');
const { OCR_REVIEW_CONFIG } = require('../config/ocrReview.config');
const logger = require('../config/logger');

async function expireStaleOcrSessions() {
  const cutoff = new Date(Date.now() - OCR_REVIEW_CONFIG.sessionTtlHours * 60 * 60 * 1000);
  const result = await KycSession.updateMany(
    {
      sessionType: 'aadhaar_ocr',
      internalStatus: { $in: ['awaiting_front', 'awaiting_back'] },
      createdAt: { $lt: cutoff },
    },
    {
      $set: {
        internalStatus: 'expired',
        status: 'expired',
        visibleStatus: 'expired',
        failureReason: 'Session expired',
      },
    }
  );
  return { expired: result.modifiedCount || 0 };
}

async function reconcileProfileSyncGaps() {
  const sessions = await KycSession.find({
    sessionType: 'aadhaar_ocr',
    visibleStatus: 'verified',
    'ocr.profileSyncedAt': { $exists: false },
  }).limit(20);

  let fixed = 0;
  for (const s of sessions) {
    await processDueReviewVisibility();
    fixed += 1;
  }
  return { checked: sessions.length, fixed };
}

async function runOcrReconciliation() {
  const expired = await expireStaleOcrSessions();
  const visibility = await processDueReviewVisibility();
  const profile = await reconcileProfileSyncGaps();

  logger.info('OCR reconciliation run', { expired, visibility, profile });
  return { expired, visibility, profile };
}

module.exports = {
  runOcrReconciliation,
  expireStaleOcrSessions,
};
