/**
 * Base Verification Provider
 * All verification providers inherit from this base class
 * 
 * PRODUCTION-READY: Supports current (Aadhaar) + future features (PAN, Bank, Face)
 * 
 * @class BaseVerificationProvider
 */
class BaseVerificationProvider {
  constructor(config) {
    this.config = config;
    this.providerName = config.providerName || 'unknown';
  }

  // =====================================================
  // AADHAAR VERIFICATION (IMPLEMENTED NOW)
  // =====================================================

  /**
   * Generate OTP for Aadhaar verification
   * @param {string} aadhaarNumber - 12-digit Aadhaar number
   * @returns {Promise<{success: boolean, refId?: string, message?: string}>}
   */
  async generateAadhaarOTP(aadhaarNumber) {
    throw new Error(`${this.providerName}: generateAadhaarOTP not implemented`);
  }

  /**
   * Verify Aadhaar OTP
   * @param {string} refId - Reference ID from generateAadhaarOTP
   * @param {string} otp - OTP entered by user
   * @returns {Promise<{success: boolean, verifiedData?: object, maskedAadhaar?: string}>}
   */
  async verifyAadhaarOTP(refId, otp) {
    throw new Error(`${this.providerName}: verifyAadhaarOTP not implemented`);
  }

  /**
   * Resend OTP for Aadhaar verification
   * @param {string} refId - Reference ID from previous OTP generation
   * @returns {Promise<{success: boolean, refId?: string, message?: string}>}
   */
  async resendAadhaarOTP(refId) {
    throw new Error(`${this.providerName}: resendAadhaarOTP not implemented`);
  }

  // =====================================================
  // PAN VERIFICATION (FUTURE - READY TO ENABLE)
  // =====================================================

  /**
   * Verify PAN card
   * @param {string} panNumber - PAN number (e.g., ABCDE1234F)
   * @returns {Promise<{success: boolean, data?: object}>}
   */
  async verifyPAN(panNumber) {
    throw new Error(`${this.providerName}: PAN verification not yet enabled. Feature flag required.`);
  }

  // =====================================================
  // GSTIN VERIFICATION
  // =====================================================

  /**
   * Verify GSTIN number
   * @param {string} gstin - 15-character GSTIN
   * @param {string} [businessName] - Optional business name to match
   * @returns {Promise<{success: boolean, data?: object, message?: string}>}
   */
  async verifyGSTIN(gstin, businessName) {
    throw new Error(`${this.providerName}: GSTIN verification not supported`);
  }

  // =====================================================
  // BANK VERIFICATION (FUTURE - READY TO ENABLE)
  // =====================================================

  /**
   * Verify bank account
   * @param {string} accountNumber - Bank account number
   * @param {string} ifsc - IFSC code
   * @returns {Promise<{success: boolean, data?: object}>}
   */
  async verifyBankAccount(accountNumber, ifsc, accountHolderName) {
    throw new Error(`${this.providerName}: Bank verification not yet enabled. Feature flag required.`);
  }

  // =====================================================
  // FACE VERIFICATION (FUTURE - READY TO ENABLE)
  // =====================================================

  /**
   * Verify face match between two images
   * @param {string} selfieImageBase64 - User's selfie (base64)
   * @param {string} documentImageBase64 - ID document photo (base64)
   * @returns {Promise<{success: boolean, matchScore: number, isMatch: boolean}>}
   */
  async verifyFaceMatch(selfieImageBase64, documentImageBase64) {
    // Mock implementation for testing
    // In production, override in specific provider (Signzy/Karza)
    const mockMatchScore = Math.random() * 0.3 + 0.7; // 0.7 to 1.0
    const isMatch = mockMatchScore >= 0.75;
    
    return {
      success: isMatch,
      data: {
        matchScore: mockMatchScore,
        threshold: 0.75,
        confidence: mockMatchScore > 0.9 ? 'HIGH' : mockMatchScore > 0.8 ? 'MEDIUM' : 'LOW'
      },
      message: isMatch ? 'Face matched successfully' : 'Face does not match'
    };
  }

  /**
   * Verify liveness (user is a real person, not a photo/video)
   * @param {string} videoBase64 - Video or image sequence (base64)
   * @returns {Promise<{success: boolean, isLive: boolean, confidence: number}>}
   */
  async verifyLiveness(videoBase64) {
    // Mock implementation for testing
    // Check for test verification IDs from Cashfree test data
    if (typeof videoBase64 === 'string') {
      if (videoBase64.startsWith('2222')) {
        // MULTIPLE_FACES_DETECTED
        return {
          success: false,
          data: { isLive: false, confidence: 0 },
          message: 'Multiple faces detected'
        };
      } else if (videoBase64.startsWith('3333')) {
        // FACE_NOT_DETECTED
        return {
          success: false,
          data: { isLive: false, confidence: 0 },
          message: 'Face not detected'
        };
      } else if (videoBase64.startsWith('4444')) {
        // REAL_FACE_NOT_DETECTED
        return {
          success: false,
          data: { isLive: false, confidence: 0.3 },
          message: 'Real face not detected (possible spoof)'
        };
      }
    }
    
    // Default success case
    const confidence = Math.random() * 0.2 + 0.8; // 0.8 to 1.0
    return {
      success: true,
      data: {
        isLive: true,
        confidence: confidence
      },
      message: 'Liveness verified successfully'
    };
  }

  /**
   * Verify face matches Aadhaar photo
   * @param {string} selfieImageBase64 - User's selfie
   * @param {string} aadhaarRefId - Reference ID from Aadhaar verification
   * @returns {Promise<{success: boolean, matchScore: number}>}
   */
  async verifyFaceWithAadhaar(selfieImageBase64, aadhaarRefId) {
    throw new Error(`${this.providerName}: Face-Aadhaar verification not yet enabled. Feature flag required.`);
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  /**
   * Mask Aadhaar number (format: XXXX XXXX 1234)
   * @param {string} aadhaar - 12-digit Aadhaar number
   * @returns {string} Masked Aadhaar
   */
  maskAadhaar(aadhaar) {
    if (!aadhaar || aadhaar.length !== 12) {
      return 'XXXX XXXX XXXX';
    }
    const last4 = aadhaar.slice(-4);
    return `XXXX XXXX ${last4}`;
  }

  /**
   * Mask PAN number (format: ABXXX1234F)
   * @param {string} pan - PAN number
   * @returns {string} Masked PAN
   */
  maskPAN(pan) {
    if (!pan || pan.length !== 10) {
      return 'XXXXX1234X';
    }
    return `${pan.slice(0, 2)}XXX${pan.slice(-4)}`;
  }

  /**
   * Mask GSTIN number (format: 29XXXXXXXXX1ZR)
   * @param {string} gstin - 15-character GSTIN
   * @returns {string} Masked GSTIN
   */
  maskGSTIN(gstin) {
    if (!gstin || gstin.length !== 15) {
      return 'XXXXXXXXXXXXXXX';
    }
    return `${gstin.slice(0, 2)}XXXXXXXXX${gstin.slice(-4)}`;
  }

  /**
   * Mask bank account number (format: XXXX1234)
   * @param {string} accountNumber - Bank account number
   * @returns {string} Masked account number
   */
  maskBankAccount(accountNumber) {
    if (!accountNumber || accountNumber.length < 4) {
      return 'XXXX';
    }
    return `XXXX${accountNumber.slice(-4)}`;
  }

  /**
   * Get provider information
   * @returns {object} Provider metadata
   */
  getProviderInfo() {
    return {
      name: this.providerName,
      capabilities: {
        aadhaar: this.hasAadhaarSupport(),
        pan: this.hasPANSupport(),
        gstin: this.hasGSTINSupport(),
        bank: this.hasBankSupport(),
        face: this.hasFaceSupport(),
      },
    };
  }

  // Capability checks (override in child classes)
  hasAadhaarSupport() { return false; }
  hasPANSupport() { return false; }
  hasGSTINSupport() { return false; }
  hasBankSupport() { return false; }
  hasFaceSupport() { return false; }
}

module.exports = BaseVerificationProvider;

