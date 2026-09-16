const BaseVerificationProvider = require('./BaseProvider');
const logger = require('../../config/logger');

/**
 * Mock Verification Provider for Testing
 * Returns fake data without calling any external APIs
 * 
 * Use this provider during development/testing to avoid API rate limits
 * and costs. Set VERIFICATION_PROVIDER=mock in .env
 */
class MockProvider extends BaseVerificationProvider {
  constructor(config = {}) {
    if (process.env.NODE_ENV === 'production' || config.NODE_ENV === 'production') {
      throw new Error('MockProvider cannot be initialized in production environment');
    }
    super(config);
    this.providerName = 'mock';
    this.testOtp = '111000'; // Standard test OTP

    logger.info('✅ MockProvider initialized (NO REAL API CALLS)');
  }

  // =====================================================
  // CAPABILITY CHECKS
  // =====================================================

  hasAadhaarSupport() { return true; }
  hasPANSupport() { return true; }
  hasGSTINSupport() { return true; }
  hasBankSupport() { return true; }
  hasFaceSupport() { return true; }

  // =====================================================
  // AADHAAR VERIFICATION (MOCK)
  // =====================================================

  /**
   * Generate OTP for Aadhaar verification (MOCK)
   * Always returns success with a fake refId
   */
  async generateAadhaarOTP(aadhaarNumber) {
    // Validate Aadhaar format
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      throw new Error('Invalid Aadhaar number format. Must be 12 digits.');
    }

    logger.info('🎭 [MOCK] Generating Aadhaar OTP', {
      aadhaarNumber: this.maskAadhaar(aadhaarNumber)
    });

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check test Aadhaar numbers from Cashfree docs
    const validTestNumbers = ['655675523712', '655675523711'];
    const invalidTestNumbers = ['655675523710', '655675523709'];

    if (invalidTestNumbers.includes(aadhaarNumber)) {
      logger.warn('🎭 [MOCK] Invalid test Aadhaar number');
      return {
        success: false,
        message: 'Invalid Aadhaar number',
        status: 'invalid'
      };
    }

    // Generate a fake refId
    const refId = `MOCK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info('✅ [MOCK] OTP generated successfully', {
      refId,
      testOtp: this.testOtp
    });

    return {
      success: true,
      refId,
      message: 'OTP sent successfully',
      status: 'otp_sent',
      mockNote: `Use test OTP: ${this.testOtp}`
    };
  }

  /**
   * Verify Aadhaar OTP (MOCK)
   * Accepts the standard test OTP (111000)
   */
  async verifyAadhaarOTP(refId, otp) {
    logger.info('🎭 [MOCK] Verifying Aadhaar OTP', { refId, otp: '***' });

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if OTP is correct
    if (otp === this.testOtp || otp === '111000') {
      logger.info('✅ [MOCK] OTP verification successful');
      
      return {
        success: true,
        message: 'Aadhaar verified successfully',
        status: 'verified',
        verifiedData: {
          name: 'John Doe',
          dob: '1990-01-01',
          gender: 'M',
          address: 'Test Address, Test City, Test State - 123456',
          maskedAadhaar: 'XXXX XXXX 3712'
        }
      };
    }

    // Different error responses based on OTP
    if (otp === '000111') {
      logger.warn('🎭 [MOCK] Invalid OTP');
      return {
        success: false,
        message: 'Invalid OTP',
        status: 'invalid_otp'
      };
    }

    if (otp === '000222') {
      logger.warn('🎭 [MOCK] Verification failed');
      return {
        success: false,
        message: 'Verification failed',
        status: 'failed'
      };
    }

    // Default invalid OTP
    logger.warn('🎭 [MOCK] Incorrect OTP');
    return {
      success: false,
      message: 'Incorrect OTP. Please try again.',
      status: 'invalid_otp'
    };
  }

  /**
   * Resend Aadhaar OTP (MOCK)
   * Always returns success
   */
  async resendAadhaarOTP(refId) {
    logger.info('🎭 [MOCK] Resending Aadhaar OTP', { refId });

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 500));

    logger.info('✅ [MOCK] OTP resent successfully', {
      testOtp: this.testOtp
    });

    return {
      success: true,
      message: 'OTP resent successfully',
      status: 'otp_sent',
      mockNote: `Use test OTP: ${this.testOtp}`
    };
  }

  // =====================================================
  // PAN VERIFICATION (MOCK)
  // =====================================================

  async verifyPAN(panNumber, name) {
    logger.info('🎭 [MOCK] Verifying PAN', { pan: this.maskPAN(panNumber) });
    
    await new Promise(resolve => setTimeout(resolve, 300));

    const cleanPan = String(panNumber || '').trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
      return {
        success: false,
        message: 'Invalid PAN format'
      };
    }

    return {
      success: true,
      message: 'PAN verified successfully',
      data: {
        panNumber: this.maskPAN(cleanPan),
        name: name || (cleanPan === 'NVRPK6324Q' ? 'PAVAN KUMAR' : 'John Doe'),
        status: 'VALID'
      }
    };
  }

  // =====================================================
  // GSTIN VERIFICATION (MOCK)
  // =====================================================

  async verifyGSTIN(gstin, businessName) {
    const cleanedGstin = String(gstin || '').replace(/[\s-]/g, '').trim().toUpperCase();
    logger.info('🎭 [MOCK] Verifying GSTIN', { gstin: this.maskGSTIN(cleanedGstin) });
    
    await new Promise(resolve => setTimeout(resolve, 300));

    // Valid test GSTINs
    const validGSTINs = ['29AAICP2912R1ZR', '27AABCU9603R1ZN', '36AAACB8506M1ZP', '07AAAAA0000A1Z5'];

    if (validGSTINs.includes(cleanedGstin)) {
      return {
        success: true,
        message: 'GSTIN verified successfully',
        data: {
          gstin: cleanedGstin,
          maskedGSTIN: this.maskGSTIN(cleanedGstin),
          legalName: businessName || 'MOCK TECH SOLUTIONS PRIVATE LIMITED',
          tradeName: businessName || 'MOCK STORE',
          status: 'Active',
          taxpayerType: 'Regular',
          registrationDate: '01/07/2017',
          stateCode: cleanedGstin.substring(0, 2),
          referenceId: 'MOCK_GSTIN_' + Date.now()
        }
      };
    }

    return {
      success: false,
      message: 'Invalid GSTIN number',
      data: null
    };
  }

  // =====================================================
  // BANK VERIFICATION (MOCK)
  // =====================================================

  async verifyBankAccount(accountNumber, ifsc) {
    logger.info('🎭 [MOCK] Verifying Bank Account', {
      account: this.maskBankAccount(accountNumber),
      ifsc
    });
    
    await new Promise(resolve => setTimeout(resolve, 500));

    // Valid test accounts from Cashfree docs
    const validAccounts = {
      '026291800001191': 'YESB0000262',
      '00011020001772': 'HDFC0000001',
      '000890289871772': 'SCBL0036078'
    };

    if (validAccounts[accountNumber] === ifsc) {
      return {
        success: true,
        message: 'Bank account verified successfully',
        data: {
          accountNumber: this.maskBankAccount(accountNumber),
          ifsc,
          nameAtBank: 'JOHN DOE',
          accountExists: true
        }
      };
    }

    return {
      success: false,
      message: 'Invalid account or IFSC'
    };
  }

  // =====================================================
  // UTILITIES
  // =====================================================

  getTestOtp() {
    return this.testOtp;
  }

  isSandbox() {
    return true; // Mock is always "sandbox"
  }
}

module.exports = MockProvider;

