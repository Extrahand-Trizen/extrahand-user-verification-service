/**
 * Centralized OCR validation thresholds.
 * Tune fraud/quality rules here without touching service logic.
 */

const OCR_VALIDATION_CONFIG = {
  /** Hard-reject fraud signals (initially permissive — only obvious forgery) */
  fraud: {
    hardReject: {
      is_forged: true,
      // is_overwritten: true, // enable when ops ready
    },
    softFlags: [
      'is_screenshot',
      'is_photo_of_screen',
      'is_photo_imposed',
      'is_overwritten',
    ],
    maxSoftFlagsBeforeReject: 99, // permissive: effectively never auto-reject on soft flags
  },

  /** Quality — warn only; do not hard-fail on blur/glare initially */
  quality: {
    hardReject: {},
    softFlags: ['blur', 'glare', 'partially_present', 'obscured'],
    requireFacePresent: false,
    requireFaceClear: false,
    requireQrPresent: false,
    maxSoftFlagsBeforeReject: 99,
  },

  /** QR validation */
  qr: {
    requireSecureStatus: false, // when true, qr_details.status must be SECURE
    acceptedStatuses: ['SECURE', 'VALID', 'SUCCESS'],
  },

  /** Cross-side consistency (front vs back) — future tuning */
  consistency: {
    requireMatchingLastFour: true,
    requireMatchingName: false,
  },

  /** Minimum OCR provider verification_status values accepted */
  provider: {
    acceptedVerificationStatuses: ['VALID', 'SUCCESS', 'VERIFIED'],
    rejectedVerificationStatuses: ['INVALID', 'FAILED', 'REJECTED'],
  },
};

module.exports = { OCR_VALIDATION_CONFIG };
