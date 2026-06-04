const mongoose = require('mongoose');
const { Schema, model } = mongoose;

/**
 * KycSession - Tracks each DigiLocker verification attempt
 * One session per verification flow; links to Verification on success
 */
const KycSessionSchema = new Schema(
  {
    verification_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    sessionType: {
      type: String,
      enum: ['digilocker', 'aadhaar_ocr'],
      default: 'digilocker',
      index: true,
    },
    status: {
      type: String,
      enum: [
        // DigiLocker lifecycle
        'pending',
        'in_progress',
        'completing',
        'completed',
        'failed',
        'expired',
        'consent_denied',
        // Aadhaar OCR lifecycle (mirrors internalStatus for queries)
        'awaiting_front',
        'awaiting_back',
        'processing',
        'cancelled',
      ],
      default: 'pending',
      index: true,
    },
    /** Backend truth for OCR sessions */
    internalStatus: {
      type: String,
      enum: [
        'awaiting_front',
        'awaiting_back',
        'processing',
        'completing',
        'completed',
        'failed',
        'expired',
        'cancelled',
      ],
      index: true,
    },
    /** User-facing status — frontend MUST use this for OCR */
    visibleStatus: {
      type: String,
      enum: ['pending', 'under_review', 'verified', 'failed', 'expired', 'cancelled'],
      index: true,
    },
    visibleToUserAt: {
      type: Date,
      index: true,
    },
    /** When user may see FAILED after internal failure (lazy resolution) */
    visibleFailureAt: {
      type: Date,
      index: true,
    },
    completionSource: {
      type: String,
      enum: ['webhook', 'app_callback', 'reconcile_job'],
    },

    // From Verify Account
    digilockerStatus: String, // 'ACCOUNT_EXISTS' | 'ACCOUNT_NOT_EXISTS'
    referenceId: Number,
    digilockerId: String,
    userFlow: String, // 'signin' | 'signup'

    // From Create URL
    digilockerUrl: String,
    documentRequested: [String],
    redirectUrl: String,

    // From Get Status (when AUTHENTICATED)
    documentConsent: [String],
    documentConsentValidity: Date,
    userDetails: {
      name: String,
      dob: String,
      gender: String,
      eaadhaar: String,
      mobile: String,
    },

    // Validity
    urlExpiresAt: Date, // created + 10 min
    consentExpiresAt: Date, // when AUTHENTICATED (consent time + 1 hour)

    // Webhook tracking
    lastWebhookEvent: String,
    lastWebhookEventTime: Date,

    // Error tracking
    failureReason: String,
    failureCategory: String,

    // ===== Aadhaar Smart OCR (sessionType: aadhaar_ocr) =====
    ocr: {
      frontImageKey: String,
      backImageKey: String,
      frontUploadedAt: Date,
      backUploadedAt: Date,
      frontOcrAt: Date,
      backOcrAt: Date,
      cashfreeVerificationIdFront: String,
      cashfreeVerificationIdBack: String,
      fraudSummary: mongoose.Schema.Types.Mixed,
      qualitySummary: mongoose.Schema.Types.Mixed,
      qrValidationStatus: String,
      maskedAadhaar: String,
      frontExtracted: mongoose.Schema.Types.Mixed,
      backExtracted: mongoose.Schema.Types.Mixed,
      merged: mongoose.Schema.Types.Mixed,
      purgeScheduledAt: Date,
      imagesPurgedAt: Date,
      profileSyncedAt: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
KycSessionSchema.index({ userId: 1, status: 1 });
KycSessionSchema.index({ userId: 1, createdAt: -1 });
KycSessionSchema.index({ referenceId: 1 });
KycSessionSchema.index({ userId: 1, sessionType: 1, status: 1 });
KycSessionSchema.index({ sessionType: 1, visibleToUserAt: 1, visibleStatus: 1 });
KycSessionSchema.index({ sessionType: 1, visibleFailureAt: 1, visibleStatus: 1 });
KycSessionSchema.index({ 'ocr.purgeScheduledAt': 1, 'ocr.imagesPurgedAt': 1 });

/**
 * Find session by verification_id
 */
KycSessionSchema.statics.findByVerificationId = function (verificationId) {
  return this.findOne({ verification_id: verificationId });
};

/**
 * Find latest session for user
 */
KycSessionSchema.statics.findLatestByUserId = function (userId) {
  return this.findOne({ userId }).sort({ createdAt: -1 });
};

/**
 * Find latest active session for user by session type
 */
KycSessionSchema.statics.findActiveByUserId = function (userId, sessionType, activeStatuses) {
  return this.findOne({
    userId,
    sessionType,
    status: { $in: activeStatuses },
  }).sort({ createdAt: -1 });
};

const KycSession = model('KycSession', KycSessionSchema);

module.exports = KycSession;
