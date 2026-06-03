/**

 * Review visibility & retention — single place to tune UX timing and purge policy.

 */



function parseIntEnv(name, fallback) {

  const v = parseInt(process.env[name], 10);

  return Number.isFinite(v) ? v : fallback;

}



const OCR_REVIEW_CONFIG = {

  /** Randomized delay before user sees "verified" (minutes) */

  reviewDelayMinutesMin: parseIntEnv('OCR_REVIEW_DELAY_MINUTES_MIN', 5),

  reviewDelayMinutesMax: parseIntEnv('OCR_REVIEW_DELAY_MINUTES_MAX', 10),



  /** Delay before user sees "failed" after internal failure (minutes) */

  failureVisibilityMinutesMin: parseIntEnv('OCR_FAILURE_VISIBILITY_MINUTES_MIN', 5),

  failureVisibilityMinutesMax: parseIntEnv('OCR_FAILURE_VISIBILITY_MINUTES_MAX', 15),



  /** Session TTL — abandon stale upload sessions */

  sessionTtlHours: parseIntEnv('OCR_SESSION_TTL_HOURS', 24),



  /** Image retention after successful OCR (hours) */

  imageRetentionHoursSuccess: parseIntEnv('OCR_IMAGE_RETENTION_HOURS_SUCCESS', 12),



  /** Image retention after failed OCR (days) — kept for ops/admin review */

  imageRetentionDaysFailure: parseIntEnv('OCR_IMAGE_RETENTION_DAYS_FAILURE', 7),



  /** Job intervals (ms) — secondary reconciliation only */

  reviewVisibilityJobIntervalMs: parseIntEnv('OCR_REVIEW_JOB_INTERVAL_MS', 5 * 60 * 1000),

  imagePurgeJobIntervalMs: parseIntEnv('OCR_PURGE_JOB_INTERVAL_MS', 5 * 60 * 1000),

  reconciliationJobIntervalMs: parseIntEnv('OCR_RECONCILE_JOB_INTERVAL_MS', 15 * 60 * 1000),

};



function randomMinutesInRange(minMinutes, maxMinutes) {

  const min = Math.min(minMinutes, maxMinutes);

  const max = Math.max(minMinutes, maxMinutes);

  return min + Math.floor(Math.random() * (max - min + 1));

}



/**

 * When user may see VERIFIED (randomized).

 * @returns {Date}

 */

function computeVisibleToUserAt(now = new Date()) {

  const minutes = randomMinutesInRange(

    OCR_REVIEW_CONFIG.reviewDelayMinutesMin,

    OCR_REVIEW_CONFIG.reviewDelayMinutesMax

  );

  return new Date(now.getTime() + minutes * 60 * 1000);

}



/**

 * When user may see FAILED after internal failure (randomized).

 * @returns {Date}

 */

function computeVisibleFailureAt(now = new Date()) {

  const minutes = randomMinutesInRange(

    OCR_REVIEW_CONFIG.failureVisibilityMinutesMin,

    OCR_REVIEW_CONFIG.failureVisibilityMinutesMax

  );

  return new Date(now.getTime() + minutes * 60 * 1000);

}



module.exports = {

  OCR_REVIEW_CONFIG,

  computeVisibleToUserAt,

  computeVisibleFailureAt,

  randomMinutesInRange,

};


