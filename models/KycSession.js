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
      enum: ['digilocker'],
      default: 'digilocker',
    },
    status: {
      type: String,
      enum: [
        'pending',
        'in_progress',
        'completed',
        'failed',
        'expired',
        'consent_denied',
      ],
      default: 'pending',
      index: true,
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
  },
  {
    timestamps: true,
  }
);

// Indexes
KycSessionSchema.index({ userId: 1, status: 1 });
KycSessionSchema.index({ userId: 1, createdAt: -1 });
KycSessionSchema.index({ referenceId: 1 });

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

const KycSession = model('KycSession', KycSessionSchema);

module.exports = KycSession;
