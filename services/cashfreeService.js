const CashfreeProvider = require('./providers/CashfreeProvider');
const logger = require('../config/logger');

/**
 * Cashfree Service (Legacy Wrapper)
 * This maintains backward compatibility with existing code
 * while using the new CashfreeProvider internally
 * 
 * DEPRECATED: New code should use providerFactory.getVerificationProvider() instead
 * 
 * @deprecated Use providerFactory.getVerificationProvider() for new code
 */
class CashfreeService {
  constructor() {
    this.provider = null;
    this.initialized = false;
  }

  /**
   * Initialize the service with configuration
   */
  initialize(config) {
    this.provider = new CashfreeProvider(config);
    this.initialized = true;

    logger.info('✅ Cashfree Service initialized (legacy wrapper)', {
      environment: config.CASHFREE_ENV || 'sandbox',
    });
  }

  /**
   * Generate OTP for Aadhaar verification
   * @deprecated Delegates to CashfreeProvider
   */
  async generateAadhaarOTP(aadhaarNumber) {
    if (!this.initialized) {
      throw new Error('Cashfree service not initialized');
    }
    return this.provider.generateAadhaarOTP(aadhaarNumber);
  }

  /**
   * Verify Aadhaar OTP
   * @deprecated Delegates to CashfreeProvider
   */
  async verifyAadhaarOTP(refId, otp) {
    if (!this.initialized) {
      throw new Error('Cashfree service not initialized');
    }
    return this.provider.verifyAadhaarOTP(refId, otp);
  }

  /**
   * Resend OTP for Aadhaar verification
   * @deprecated Delegates to CashfreeProvider
   */
  async resendAadhaarOTP(refId) {
    if (!this.initialized) {
      throw new Error('Cashfree service not initialized');
    }
    return this.provider.resendAadhaarOTP(refId);
  }

  /**
   * Mask Aadhaar number
   * @deprecated Delegates to CashfreeProvider
   */
  maskAadhaar(aadhaarNumber) {
    return this.provider.maskAadhaar(aadhaarNumber);
  }

  /**
   * Get test OTP for sandbox environment
   * @deprecated Delegates to CashfreeProvider
   */
  getTestOtp() {
    return this.provider.getTestOtp();
  }

  /**
   * Check if service is in sandbox mode
   * @deprecated Delegates to CashfreeProvider
   */
  isSandbox() {
    return this.provider.isSandbox();
  }
}

// Export singleton instance
const cashfreeService = new CashfreeService();

module.exports = cashfreeService;

