/**
 * Background jobs for Aadhaar OCR subsystem.
 * Started only when FEATURE_AADHAAR_OCR=true.
 */

const logger = require('../config/logger');
const { OCR_REVIEW_CONFIG } = require('../config/ocrReview.config');
const { runOcrReviewVisibilityJob } = require('./ocrReviewVisibilityJob');
const { purgeDueOcrImages } = require('./ocrImagePurgeJob');
const { runOcrReconciliationJob } = require('./ocrReconciliationJob');

const timers = [];

function startOcrJobs() {
  if (process.env.FEATURE_AADHAAR_OCR !== 'true') {
    logger.info('OCR background jobs disabled (FEATURE_AADHAAR_OCR != true)');
    return;
  }

  timers.push(
    setInterval(() => {
      runOcrReviewVisibilityJob().catch((e) =>
        logger.error('OCR review visibility job error', { error: e.message })
      );
    }, OCR_REVIEW_CONFIG.reviewVisibilityJobIntervalMs)
  );

  timers.push(
    setInterval(() => {
      purgeDueOcrImages().catch((e) =>
        logger.error('OCR image purge job error', { error: e.message })
      );
    }, OCR_REVIEW_CONFIG.imagePurgeJobIntervalMs)
  );

  timers.push(
    setInterval(() => {
      runOcrReconciliationJob().catch((e) =>
        logger.error('OCR reconciliation job error', { error: e.message })
      );
    }, OCR_REVIEW_CONFIG.reconciliationJobIntervalMs)
  );

  logger.info('OCR background jobs started');
}

function stopOcrJobs() {
  timers.forEach(clearInterval);
  timers.length = 0;
}

module.exports = { startOcrJobs, stopOcrJobs };
