/**
 * Config-driven OCR validation — tune rules in config/ocrValidation.config.js only.
 */

const { OCR_VALIDATION_CONFIG } = require('../config/ocrValidation.config');

function countSoftFlags(summary, flagNames) {
  if (!summary) return 0;
  return flagNames.filter((f) => summary[f] === true).length;
}

/** Cashfree often returns verification_status:null while document_fields are populated. */
function hasExtractedIdentity(mapped) {
  if (!mapped) return false;
  const name = String(mapped.name || '').trim();
  if (name.length < 2) return false;
  return Boolean(
    mapped.dob ||
      mapped.yearOfBirth ||
      mapped.maskedAadhaar ||
      mapped.qrSummary?.aadhaarLastFourMasked
  );
}

function evaluateHardReject(summary, hardRejectMap) {
  for (const [key, mustBe] of Object.entries(hardRejectMap || {})) {
    if (mustBe === true && summary?.[key] === true) {
      return { reject: true, reason: `fraud_${key}`, field: key };
    }
  }
  return { reject: false };
}

/**
 * @param {object} mapped - smartOcrMapper output
 * @returns {{ accepted: boolean, warnings: string[], rejectReason?: string, code?: string }}
 */
function validateOcrMappedResult(mapped) {
  const warnings = [];
  const { fraud, quality, qr, provider } = OCR_VALIDATION_CONFIG;

  if (!mapped) {
    return { accepted: false, rejectReason: 'Empty OCR result', code: 'OCR_EMPTY' };
  }

  const status = String(mapped.verificationStatus || '').toUpperCase();
  if (provider.rejectedVerificationStatuses.includes(status)) {
    return {
      accepted: false,
      rejectReason: 'Document could not be verified',
      code: 'PROVIDER_REJECTED',
    };
  }

  const fraudHard = evaluateHardReject(mapped.fraudSummary, fraud.hardReject);
  if (fraudHard.reject) {
    return {
      accepted: false,
      rejectReason: 'Document failed security checks',
      code: 'FRAUD_HARD_REJECT',
      warnings,
    };
  }

  const qualityHard = evaluateHardReject(mapped.qualitySummary, quality.hardReject);
  if (qualityHard.reject) {
    return {
      accepted: false,
      rejectReason: 'Image quality too low',
      code: 'QUALITY_HARD_REJECT',
      warnings,
    };
  }

  const fraudSoftCount = countSoftFlags(mapped.fraudSummary, fraud.softFlags);
  if (fraudSoftCount >= fraud.maxSoftFlagsBeforeReject) {
    return {
      accepted: false,
      rejectReason: 'Document failed security checks',
      code: 'FRAUD_SOFT_LIMIT',
    };
  }
  if (fraudSoftCount > 0) {
    warnings.push('fraud_soft_flags');
  }

  const qualitySoftCount = countSoftFlags(mapped.qualitySummary, quality.softFlags);
  if (qualitySoftCount >= quality.maxSoftFlagsBeforeReject) {
    return {
      accepted: false,
      rejectReason: 'Image quality too low',
      code: 'QUALITY_SOFT_LIMIT',
    };
  }
  if (qualitySoftCount > 0) {
    warnings.push('quality_soft_flags');
  }

  if (quality.requireFacePresent && !mapped.qualitySummary?.face_present) {
    warnings.push('face_not_present');
  }
  if (quality.requireQrPresent && !mapped.qualitySummary?.qr_present) {
    warnings.push('qr_not_present');
  }

  if (qr.requireSecureStatus) {
    const qs = String(mapped.qrValidationStatus || '').toUpperCase();
    if (!qr.acceptedStatuses.includes(qs)) {
      return {
        accepted: false,
        rejectReason: 'QR validation failed',
        code: 'QR_NOT_SECURE',
      };
    }
  }

  if (
    provider.acceptedVerificationStatuses.length > 0 &&
    status &&
    !provider.acceptedVerificationStatuses.includes(status)
  ) {
    warnings.push('provider_status_unconfirmed');
  }

  return { accepted: true, warnings };
}

/**
 * Cross-check front vs back last-four consistency.
 */
function validateFrontBackConsistency(frontMapped, backMapped) {
  const { consistency } = OCR_VALIDATION_CONFIG;
  if (!consistency.requireMatchingLastFour) {
    return { accepted: true, warnings: [] };
  }

  const f = frontMapped?.maskedAadhaar?.slice(-4);
  const b = backMapped?.maskedAadhaar?.slice(-4);
  if (f && b && f !== b) {
    return {
      accepted: false,
      rejectReason: 'Front and back documents do not match',
      code: 'SIDE_MISMATCH',
    };
  }
  return { accepted: true, warnings: [] };
}

module.exports = {
  validateOcrMappedResult,
  validateFrontBackConsistency,
  OCR_VALIDATION_CONFIG,
};
