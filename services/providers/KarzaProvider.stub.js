const BaseVerificationProvider = require('./BaseProvider');
const logger = require('../../config/logger');

/**
 * Karza Verification Provider - STUB
 * 
 * TO ACTIVATE THIS PROVIDER:
 * 1. Get Karza API credentials (API key + secret)
 * 2. Rename this file to: KarzaProvider.js
 * 3. Implement the methods below
 * 4. Update providerFactory.js to uncomment Karza support
 * 5. Set VERIFICATION_PROVIDER=karza in .env
 * 
 * Karza Capabilities:
 * - ✅ Aadhaar e-KYC
 * - ✅ PAN verification
 * - ✅ Bank account verification (penny drop)
 * - ✅ Face verification (liveness + matching)
 * - ✅ GST verification
 * - ✅ Employment verification
 * 
 * API Documentation: https://docs.karza.in
 * Pricing: Contact Karza for custom pricing
 * 
 * @class KarzaProvider
 * @extends BaseVerificationProvider
 */
class KarzaProvider extends BaseVerificationProvider {
  constructor(config) {
    super(config);
    this.providerName = 'karza';
    this.apiKey = config.KARZA_API_KEY;
    this.apiSecret = config.KARZA_API_SECRET;
    this.baseURL = config.KARZA_BASE_URL || 'https://testapi.karza.in';

    logger.info('⚠️ KarzaProvider initialized (STUB - not yet implemented)', {
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
  hasFaceSupport() { return true; } // Karza supports face verification!

  // =====================================================
  // REQUEST HEADERS
  // =====================================================

  /**
   * Get request headers for Karza API
   */
  getHeaders() {
    // TODO: Implement when activating Karza
    /*
    return {
      'x-karza-key': this.apiKey,
      'Content-Type': 'application/json'
    };
    */
    throw new Error('Karza provider not yet implemented');
  }

  // =====================================================
  // AADHAAR VERIFICATION
  // =====================================================

  async generateAadhaarOTP(aadhaarNumber) {
    logger.warn('🔒 Karza Aadhaar verification not yet implemented');
    throw new Error('Karza provider not yet activated. Please use Cashfree or contact admin.');
  }

  async verifyAadhaarOTP(refId, otp) {
    throw new Error('Karza provider not yet activated. Please use Cashfree or contact admin.');
  }

  async resendAadhaarOTP(refId) {
    throw new Error('Karza provider not yet activated. Please use Cashfree or contact admin.');
  }

  // =====================================================
  // PAN VERIFICATION
  // =====================================================

  async verifyPAN(panNumber) {
    throw new Error('Karza provider not yet activated. Please use Cashfree or contact admin.');
  }

  // =====================================================
  // BANK VERIFICATION
  // =====================================================

  async verifyBankAccount(accountNumber, ifsc) {
    throw new Error('Karza provider not yet activated. Please use Cashfree or contact admin.');
  }

  // =====================================================
  // FACE VERIFICATION
  // =====================================================

  async verifyFaceMatch(selfieImageBase64, documentImageBase64) {
    throw new Error('Karza face verification not yet activated. Contact admin to enable.');
  }

  async verifyLiveness(videoBase64) {
    throw new Error('Karza liveness verification not yet activated. Contact admin to enable.');
  }

  async verifyFaceWithAadhaar(selfieImageBase64, aadhaarRefId) {
    throw new Error('Karza face-Aadhaar verification not yet activated. Contact admin to enable.');
  }
}

module.exports = KarzaProvider;

/* 
IMPLEMENTATION GUIDE (When Ready to Activate):

1. AADHAAR VERIFICATION:
   - Endpoint: POST /v2/aadhaar-verification
   - Request OTP first, then verify with OTP
   
2. PAN VERIFICATION:
   - Endpoint: POST /v2/pan
   - Direct verification (no OTP needed)
   
3. BANK VERIFICATION:
   - Endpoint: POST /v2/bank-verification
   - Supports both penny drop and IFSC validation
   
4. FACE VERIFICATION:
   - Endpoint: POST /v2/face-match
   - Supports liveness detection and face matching
   
Example Implementation:

async verifyPAN(panNumber) {
  const response = await axios.post(
    `${this.baseURL}/v2/pan`,
    {
      pan: panNumber,
      consent: 'Y'
    },
    {
      headers: this.getHeaders(),
      timeout: 30000
    }
  );

  return {
    success: response.data.statusCode === 101,
    data: {
      name: response.data.result.name,
      panNumber: response.data.result.pan,
      maskedPAN: this.maskPAN(panNumber),
      status: response.data.result.panStatus,
    }
  };
}
*/

