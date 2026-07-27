const BaseVerificationProvider = require('./BaseProvider');
const logger = require('../../config/logger');

/**
 * Signzy Verification Provider - STUB
 * 
 * TO ACTIVATE THIS PROVIDER:
 * 1. Get Signzy API credentials (API key + secret)
 * 2. Rename this file to: SignzyProvider.js
 * 3. Implement the methods below
 * 4. Update providerFactory.js to uncomment Signzy support
 * 5. Set VERIFICATION_PROVIDER=signzy in .env
 * 
 * Signzy Capabilities:
 * - ✅ Aadhaar e-KYC
 * - ✅ PAN verification
 * - ✅ Bank account verification
 * - ✅ Face verification (liveness + matching)
 * - ✅ Document verification (Passport, DL, Voter ID, etc.)
 * 
 * API Documentation: https://docs.signzy.com
 * Pricing: https://signzy.com/pricing
 * 
 * @class SignzyProvider
 * @extends BaseVerificationProvider
 */
class SignzyProvider extends BaseVerificationProvider {
  constructor(config) {
    super(config);
    this.providerName = 'signzy';
    this.apiKey = config.SIGNZY_API_KEY;
    this.apiSecret = config.SIGNZY_API_SECRET;
    this.baseURL = config.SIGNZY_BASE_URL || 'https://preproduction.signzy.tech';
    this.accessToken = null;

    logger.info('⚠️ SignzyProvider initialized (STUB - not yet implemented)', {
      baseURL: this.baseURL,
      hasApiKey: !!this.apiKey,
      hasApiSecret: !!this.apiSecret
    });
  }

  // =====================================================
  // CAPABILITY CHECKS
  // =====================================================

  hasAadhaarSupport() { return true; }
  hasPANSupport() { return true; }
  hasBankSupport() { return true; }
  hasFaceSupport() { return true; } // Signzy supports face verification!

  // =====================================================
  // OAUTH2 AUTHENTICATION (for Signzy)
  // =====================================================

  /**
   * Get OAuth2 access token from Signzy
   * Signzy uses patron login for authentication
   */
  async getAccessToken() {
    // TODO: Implement when activating Signzy
    /*
    if (this.accessToken) return this.accessToken;
    
    const response = await axios.post(`${this.baseURL}/api/v2/patrons/login`, {
      username: this.apiKey,
      password: this.apiSecret,
    });
    
    this.accessToken = response.data.id;
    return this.accessToken;
    */
    throw new Error('Signzy provider not yet implemented');
  }

  // =====================================================
  // AADHAAR VERIFICATION
  // =====================================================

  async generateAadhaarOTP(aadhaarNumber) {
    logger.warn('🔒 Signzy Aadhaar verification not yet implemented');
    throw new Error('Signzy provider not yet activated. Please use Cashfree or contact admin.');
  }

  async verifyAadhaarOTP(refId, otp) {
    throw new Error('Signzy provider not yet activated. Please use Cashfree or contact admin.');
  }

  async resendAadhaarOTP(refId) {
    throw new Error('Signzy provider not yet activated. Please use Cashfree or contact admin.');
  }

  // =====================================================
  // PAN VERIFICATION
  // =====================================================

  async verifyPAN(panNumber) {
    throw new Error('Signzy provider not yet activated. Please use Cashfree or contact admin.');
  }

  // =====================================================
  // BANK VERIFICATION
  // =====================================================

  async verifyBankAccount(accountNumber, ifsc) {
    throw new Error('Signzy provider not yet activated. Please use Cashfree or contact admin.');
  }

  // =====================================================
  // FACE VERIFICATION (Signzy's specialty!)
  // =====================================================

  async verifyFaceMatch(selfieImageBase64, documentImageBase64) {
    throw new Error('Signzy face verification not yet activated. Contact admin to enable.');
  }

  async verifyLiveness(videoBase64) {
    throw new Error('Signzy liveness verification not yet activated. Contact admin to enable.');
  }

  async verifyFaceWithAadhaar(selfieImageBase64, aadhaarRefId) {
    throw new Error('Signzy face-Aadhaar verification not yet activated. Contact admin to enable.');
  }
}

module.exports = SignzyProvider;

/* 
IMPLEMENTATION GUIDE (When Ready to Activate):

1. AADHAAR VERIFICATION:
   - Endpoint: POST /api/v3/aadhaar/otp
   - Verify: POST /api/v3/aadhaar/verify
   
2. PAN VERIFICATION:
   - Endpoint: POST /api/v3/pan/verify
   
3. BANK VERIFICATION:
   - Endpoint: POST /api/v3/bank/verify
   
4. FACE VERIFICATION:
   - Face Match: POST /api/v3/faces/compare
   - Liveness: POST /api/v3/faces/liveness
   - Face with Aadhaar: First get Aadhaar photo, then compare
   
Example Implementation:

async verifyFaceMatch(selfieImageBase64, documentImageBase64) {
  const token = await this.getAccessToken();
  
  const response = await axios.post(
    `${this.baseURL}/api/v3/faces/compare`,
    {
      image1: selfieImageBase64,
      image2: documentImageBase64,
    },
    {
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    }
  );

  const matchScore = response.data.result?.confidence || 0;
  
  return {
    success: matchScore >= 80,
    matchScore,
    isMatch: matchScore >= 80,
  };
}
*/

