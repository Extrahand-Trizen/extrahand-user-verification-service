const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const VerificationSchema = new Schema({
  // ===== USER REFERENCE =====
  userId: {
    type: String,
    required: true,
    index: true // Not unique - users can have multiple verification types
  },
  
  // ===== VERIFICATION TYPE (EXTENSIBLE) =====
  type: {
    type: String,
    enum: [
      // ACTIVE NOW
      'aadhaar',
      'email',
      
      // READY FOR FUTURE (feature flags)
      'pan',
      'bank_account',
      'driving_license',
      'face_match',
      'liveness',
      'face_aadhaar',
    ],
    required: true,
    index: true
  },
  
  // ===== STATUS =====
  status: {
    type: String,
    enum: ['pending', 'otp_sent', 'otp_verified', 'under_review', 'verified', 'failed', 'expired'],
    default: 'pending',
    index: true
  },

  verificationMethod: {
    type: String,
    enum: ['digilocker', 'aadhaar_ocr', 'aadhaar_otp', 'admin_manual'],
    index: true,
  },
  
  // ===== PROVIDER INFORMATION =====
  provider: {
    type: String,
    enum: ['cashfree', 'signzy', 'karza', 'mock', 'admin_manual', 'internal'],
    default: 'cashfree',
    index: true
  },
  transactionId: String,
  refId: {
    type: String,
    index: true
  },
  
  // ===== VERIFICATION SOURCE TRACKING (for admin vs self-service) =====
  verificationSource: {
    type: String,
    enum: ['self_service_api', 'admin_manual', 'admin_api', 'system', 'webhook', 'app_callback', 'reconcile_job'],
    default: 'self_service_api',
    required: true,
    index: true
  },
  
  // ===== ADMIN VERIFICATION INFO (who verified the document) =====
  verifiedBy: {
    userId: String,      // Admin user ID
    userName: String,    // Admin name
    role: String         // Admin role
  },
  
  // ===== UPDATE HISTORY (track changes over time) =====
  updateHistory: [{
    previousMaskedValue: String,
    newMaskedValue: String,
    previousProvider: String,
    newProvider: String,
    previousSource: String,
    newSource: String,
    updatedAt: Date,
    updatedBy: String,
    reason: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  
  // ===== AADHAAR FIELDS (ACTIVE) =====
  maskedAadhaar: String, // Format: XXXX XXXX 1234

  /** OCR-only summaries (no raw OCR JSON, no full Aadhaar) */
  ocrMetadata: {
    fraudSummary: mongoose.Schema.Types.Mixed,
    qualitySummary: mongoose.Schema.Types.Mixed,
    qrValidationStatus: String,
    visibleToUserAt: Date,
    internalCompletedAt: Date,
    userVisibleAt: Date,
  },
  
  // ===== EMAIL FIELDS =====
  maskedEmail: String, // Format: j***@example.com
  
  // ===== FUTURE FIELDS (READY BUT UNUSED NOW) =====
  maskedPAN: String, // Format: ABXXX1234F
  maskedBankAccount: String, // Format: XXXX1234
  maskedDrivingLicense: String,
  
  // ===== VERIFIED DATA (MASKED/ENCRYPTED) =====
  verifiedData: {
    name: String,
    /** Full date of birth from OCR/QR (e.g. YYYY-MM-DD or DD-MM-YYYY as returned by provider) */
    dob: String,
    yearOfBirth: String,
    gender: String,
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String
    },
    mobileHash: String,
    photoLink: String,
  },
  
  // ===== OTP FIELDS (for Aadhaar/OTP-based verification) =====
  otpSent: {
    type: Boolean,
    default: false
  },
  otpSentAt: Date,
  otpExpiresAt: Date, // OTP expiration (typically 10 minutes)
  otpHash: String, // Hashed OTP for secure verification
  otpVerified: {
    type: Boolean,
    default: false
  },
  otpVerifiedAt: Date,
  otpAttempts: {
    type: Number,
    default: 0,
    max: 5
  },
  
  // ===== FACE VERIFICATION FIELDS (FUTURE) =====
  faceVerification: {
    matchScore: Number, // 0-100
    livenessScore: Number, // 0-100
    livenessResult: {
      type: String,
      enum: ['LIVE', 'SPOOF', 'UNKNOWN']
    },
    faceImageHash: String, // Hash of face image (never store actual image!)
    verificationMethod: {
      type: String,
      enum: ['selfie_document', 'selfie_aadhaar', 'liveness_only']
    }
  },
  
  // ===== LINKED VERIFICATIONS =====
  // E.g., face verification can link to Aadhaar verification
  linkedVerificationId: {
    type: Schema.Types.ObjectId,
    ref: 'Verification'
  },
  // DigiLocker KYC session (when verification done via DigiLocker)
  kycSessionId: {
    type: Schema.Types.ObjectId,
    ref: 'KycSession'
  },
  
  // ===== ENHANCED CONSENT & COMPLIANCE =====
  consent: {
    given: {
      type: Boolean,
      required: true,
      default: false
    },
    givenAt: Date,
    ipAddress: String,
    userAgent: String,
    consentVersion: {
      type: String,
      default: 'v1.0'
    },
    consentText: String, // Full consent text user agreed to
    withdrawnAt: Date // If user withdraws consent
  },
  
  // ===== AUDIT TRAIL =====
  auditLog: [{
    action: {
      type: String,
      enum: [
        'initiated',
        'otp_sent',
        'otp_verified',
        'otp_failed',
        'verified',
        'reverified',
        'retry_failed',
        'failed',
        'expired',
        'consent_withdrawn'
      ]
    },
    performedBy: String, // userId or 'system'
    performedAt: {
      type: Date,
      default: Date.now
    },
    ipAddress: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  
  // ===== COMPLIANCE FLAGS =====
  complianceFlags: {
    dataMinimization: {
      type: Boolean,
      default: true
    }, // Only store necessary data
    rightToErasure: {
      type: Boolean,
      default: false
    }, // User requested deletion
    dataRetentionDays: {
      type: Number,
      default: 365
    }, // How long to keep data
    scheduledDeletionAt: Date
  },
  
  // ===== TIMESTAMPS =====
  initiatedAt: Date,
  verifiedAt: Date,
  failedAt: Date,
  failureReason: String,
  
  // ===== METADATA =====
  metadata: {
    email: String, // Store actual email for email verification
    ipAddress: String,
    userAgent: String,
    environment: String, // sandbox or production
    appVersion: String,
    deviceInfo: String
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// ===== INDEXES FOR COMMON QUERIES =====
VerificationSchema.index({ userId: 1, type: 1 }, { unique: true }); // UNIQUE: Only one verification per user per type
VerificationSchema.index({ userId: 1, status: 1 }); // User + status
VerificationSchema.index({ userId: 1, verificationSource: 1 }); // User + source
VerificationSchema.index({ transactionId: 1 });
VerificationSchema.index({ refId: 1 });
VerificationSchema.index({ createdAt: -1 });
VerificationSchema.index({ provider: 1, status: 1 });
VerificationSchema.index({ 'complianceFlags.scheduledDeletionAt': 1 }); // For cleanup jobs
VerificationSchema.index({ kycSessionId: 1 });

// ===== PRE-SAVE HOOK =====
VerificationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// ===== STATIC METHODS =====

/**
 * Find verification by userId (latest)
 * For backward compatibility - use findByUserIdAndType for specific types
 */
VerificationSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId }).sort({ createdAt: -1 });
};

/**
 * Find verification by userId and type
 */
VerificationSchema.statics.findByUserIdAndType = function(userId, type) {
  return this.findOne({ userId, type }).sort({ createdAt: -1 });
};

/**
 * Find all verifications for a user
 */
VerificationSchema.statics.findAllByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

/**
 * Find verification by refId
 */
VerificationSchema.statics.findByRefId = function(refId) {
  return this.findOne({ refId });
};

/**
 * Get user's overall verification status
 */
VerificationSchema.statics.getUserVerificationStatus = async function(userId) {
  const verifications = await this.find({ userId, status: 'verified' });
  
  const status = {
    isAadhaarVerified: false,
    isPANVerified: false,
    isBankVerified: false,
    isFaceVerified: false,
    isLivenessVerified: false,
    verificationTier: 0, // 0=none, 1=basic, 2=verified, 3=trusted
    verifications: []
  };

  verifications.forEach(v => {
    status.verifications.push({
      type: v.type,
      verifiedAt: v.verifiedAt,
      provider: v.provider
    });

    // Set specific flags
    if (v.type === 'aadhaar') status.isAadhaarVerified = true;
    if (v.type === 'pan') status.isPANVerified = true;
    if (v.type === 'bank_account') status.isBankVerified = true;
    if (v.type === 'face_match' || v.type === 'face_aadhaar') status.isFaceVerified = true;
    if (v.type === 'liveness') status.isLivenessVerified = true;
  });

  // Calculate tier
  if (status.isFaceVerified && status.isAadhaarVerified) {
    status.verificationTier = 3; // Trusted
  } else if (status.isAadhaarVerified && (status.isPANVerified || status.isBankVerified)) {
    status.verificationTier = 2; // Verified
  } else if (status.isAadhaarVerified) {
    status.verificationTier = 1; // Basic
  }

  return status;
};

// ===== INSTANCE METHODS =====

/**
 * Check if verification is complete
 */
VerificationSchema.methods.isVerified = function() {
  return this.status === 'verified';
};

/**
 * Check if OTP attempts exceeded
 */
VerificationSchema.methods.hasExceededAttempts = function() {
  return this.otpAttempts >= 3;
};

/**
 * Check if OTP has expired
 */
VerificationSchema.methods.isOtpExpired = function() {
  if (!this.otpExpiresAt) return false;
  return new Date() > this.otpExpiresAt;
};

/**
 * Add audit log entry
 * @param {string} action - Action type
 * @param {string} performedBy - User ID or 'system'
 * @param {string} ipAddress - IP address
 * @param {object} metadata - Additional metadata
 */
VerificationSchema.methods.addAuditLog = function(action, performedBy, ipAddress, metadata = {}) {
  this.auditLog.push({
    action,
    performedBy: performedBy || 'system',
    performedAt: new Date(),
    ipAddress,
    metadata
  });
};

const Verification = model('Verification', VerificationSchema);

module.exports = Verification;

