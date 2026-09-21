const BaseVerificationProvider = require('./BaseProvider');
const axios = require('axios');
const logger = require('../../config/logger');
const { getCashfreeBaseUrl } = require('../../config/env');
const { retryWithBackoff } = require('../../utils/errorHandler');

/**
 * Cashfree Verification Provider
 * Handles Aadhaar, PAN, and Bank verification via Cashfree API
 * 
 * PRODUCTION-READY:
 * - ✅ Aadhaar verification (ACTIVE)
 * - 🔒 PAN verification (READY - feature flag required)
 * - 🔒 Bank verification (READY - feature flag required)
 * 
 * @class CashfreeProvider
 * @extends BaseVerificationProvider
 */
class CashfreeProvider extends BaseVerificationProvider {
  constructor(config) {
    super(config);
    this.providerName = 'cashfree';
    this.baseUrl = config.CASHFREE_BASE_URL || getCashfreeBaseUrl(config);
    this.clientId = config.CASHFREE_CLIENT_ID;
    this.clientSecret = config.CASHFREE_CLIENT_SECRET;
    this.environment = config.CASHFREE_ENV || 'sandbox';
    this.testOtp = config.CASHFREE_TEST_OTP || '111000';

    logger.info('✅ CashfreeProvider initialized', {
      environment: this.environment,
      baseUrl: this.baseUrl,
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret
    });
  }

  // =====================================================
  // CAPABILITY CHECKS
  // =====================================================

  hasAadhaarSupport() { return true; }
  hasPANSupport() { return true; }
  hasGSTINSupport() { return true; }
  hasBankSupport() { return true; }
  hasFaceSupport() { return false; } // Cashfree doesn't support face verification

  // =====================================================
  // INTERNAL UTILITIES
  // =====================================================

  /**
   * Get request headers for Cashfree API
   */
  getHeaders() {
    return {
      'x-client-id': this.clientId,
      'x-client-secret': this.clientSecret,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Headers for PAN verification (includes x-api-version for aadhaar_seeding_status in response)
   */
  getPanHeaders() {
    return {
      ...this.getHeaders(),
      'x-api-version': '2022-09-12'
    };
  }

  /**
   * Check if service is in sandbox mode
   */
  isSandbox() {
    return this.environment === 'sandbox';
  }

  /**
   * Get test OTP for sandbox environment
   */
  getTestOtp() {
    return this.testOtp;
  }

  // =====================================================
  // AADHAAR VERIFICATION (ACTIVE)
  // =====================================================

  /**
   * Generate OTP for Aadhaar verification
   * @param {string} aadhaarNumber - 12-digit Aadhaar number
   * @returns {Promise<{success: boolean, refId?: string, message?: string, status?: string}>}
   */
  async generateAadhaarOTP(aadhaarNumber) {
    // Validate Aadhaar format
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      throw new Error('Invalid Aadhaar number format. Must be 12 digits.');
    }

    logger.info('🔄 [Cashfree] Generating Aadhaar OTP', {
      aadhaarNumber: this.maskAadhaar(aadhaarNumber),
      environment: this.environment
    });

    // Use retry logic with exponential backoff
    return await retryWithBackoff(
      async () => {
        try {
          const response = await axios.post(
            `${this.baseUrl}/offline-aadhaar/otp`,
            {
              aadhaar_number: aadhaarNumber
            },
            {
              headers: this.getHeaders(),
              timeout: 30000 // 30 seconds
            }
          );

          if (response.data && response.data.ref_id) {
            logger.info('✅ [Cashfree] Aadhaar OTP generated successfully', {
              refId: response.data.ref_id,
              status: response.data.status
            });

            return {
              success: true,
              refId: response.data.ref_id,
              message: response.data.message || 'OTP sent successfully',
              status: response.data.status
            };
          } else {
            throw new Error('Invalid response from Cashfree API');
          }
        } catch (error) {
          // ✨ SANDBOX FIX: Handle "OTP already generated" error (409)
          // In sandbox mode, if OTP was already generated, we can proceed
          // since the test OTP is always 111000
          if (this.isSandbox() && error.response?.status === 409) {
            const errorMsg = error.response?.data?.message || '';
            const errorData = error.response?.data || {};
            
            if (errorMsg.toLowerCase().includes('otp generated')) {
              logger.warn('⚠️ [Cashfree] OTP already generated (sandbox mode) - proceeding with test OTP', {
                aadhaarNumber: this.maskAadhaar(aadhaarNumber),
                testOtp: this.testOtp,
                errorData
              });
              
              // Try to extract ref_id from error response, or use numeric timestamp
              // Cashfree expects numeric ref_id, not string
              let refId = errorData.ref_id || errorData.refId;
              
              // If ref_id is not in error response, use numeric timestamp
              // In sandbox mode, Cashfree might accept any numeric ref_id for verification
              if (!refId || isNaN(refId)) {
                refId = Date.now().toString(); // Use numeric timestamp as string (will be converted to number)
              }
              
              // Ensure refId is numeric (remove any non-numeric characters)
              const numericRefId = refId.toString().replace(/\D/g, '');
              
              return {
                success: true,
                refId: numericRefId, // Numeric ref_id for Cashfree API
                message: `OTP already sent to your Aadhaar-linked mobile. Use test OTP: ${this.testOtp}`,
                status: 'otp_sent',
                note: 'Using previously generated OTP (sandbox mode)'
              };
            }
          }

          logger.error('❌ [Cashfree] OTP generation error', {
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
            environment: this.environment
          });

          // ✅ Handle specific Cashfree environment mismatch error
          const errorData = error.response?.data || {};
          const errorMessage = errorData.message || errorData.error || error.message || 'Failed to generate OTP';
          
          if (errorMessage.toLowerCase().includes('client secret belongs to test environment') || 
              errorMessage.toLowerCase().includes('belongs to test environment')) {
            const helpfulMessage = `Cashfree environment mismatch: Your CASHFREE_ENV is set to '${this.environment}', but the client secret is for ${this.environment === 'production' ? 'sandbox/test' : 'production'} environment. ` +
              `Please either: 1) Set CASHFREE_ENV=sandbox if using sandbox credentials, or 2) Use production credentials if CASHFREE_ENV=production.`;
            
            logger.error('❌ [Cashfree] Environment mismatch detected', {
              configuredEnv: this.environment,
              errorMessage,
              suggestion: helpfulMessage
            });
            
            throw new Error(helpfulMessage);
          }

          // Re-throw with original axios error for proper categorization
          if (error.response) {
            throw error;
          }
          throw new Error(errorMessage);
        }
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        onRetry: (attempt, error, delay) => {
          logger.warn('🔄 [Cashfree] Retrying OTP generation', {
            attempt,
            errorCode: error.code,
            nextDelay: delay
          });
        }
      }
    );
  }

  /**
   * Verify Aadhaar OTP
   * @param {string} refId - Reference ID from generateAadhaarOTP
   * @param {string} otp - OTP entered by user
   * @returns {Promise<{success: boolean, status?: string, verifiedData?: object, maskedAadhaar?: string, message?: string}>}
   */
  async verifyAadhaarOTP(refId, otp) {
    if (!refId || !otp) {
      throw new Error('refId and otp are required');
    }

    logger.info('🔄 [Cashfree] Verifying Aadhaar OTP', {
      refId,
      otpLength: otp.length,
      environment: this.environment
    });

    // Use retry logic with exponential backoff
    return await retryWithBackoff(
      async () => {
        try {
          // Ensure ref_id is numeric (Cashfree API requirement)
          // Handle cases where refId might be a string like "REUSED_1234567890"
          let numericRefId = refId;
          if (typeof refId === 'string') {
            // Remove any non-numeric characters (handles "REUSED_1234567890" case)
            numericRefId = refId.replace(/\D/g, '');
          }
          
          if (!numericRefId || numericRefId.length === 0) {
            throw new Error('Invalid ref_id: must be numeric');
          }
          
          const response = await axios.post(
            `${this.baseUrl}/offline-aadhaar/verify`,
            {
              ref_id: numericRefId, // Ensure numeric ref_id
              otp: otp
            },
            {
              headers: this.getHeaders(),
              timeout: 30000 // 30 seconds
            }
          );

          const data = response.data;

          if (data.status === 'VALID' || data.status === 'SUCCESS') {
            logger.info('✅ [Cashfree] Aadhaar OTP verified successfully', {
              refId,
              status: data.status
            });

            // Always mask Aadhaar number for security compliance
            // Cashfree may return full aadhaar_number, but we should never store it
            const aadhaarFromResponse = data.aadhaar_number || data.masked_aadhaar || '';
            const maskedAadhaarValue = aadhaarFromResponse.length === 12 
              ? this.maskAadhaar(aadhaarFromResponse) 
              : (data.masked_aadhaar || 'XXXX XXXX XXXX');

            return {
              success: true,
              status: 'verified',
              refId: data.ref_id,
              maskedAadhaar: maskedAadhaarValue,
              verifiedData: {
                name: data.name,
                gender: data.gender,
                yearOfBirth: data.year_of_birth || data.yearOfBirth,
                address: data.address ? {
                  line1: data.address.line1 || data.address,
                  line2: data.address.line2,
                  city: data.address.city,
                  state: data.address.state,
                  pincode: data.address.pincode || data.address.pinCode
                } : null,
                mobileHash: data.mobile_hash || data.mobileHash,
                photoLink: data.photo_link || data.photoLink
              },
              message: data.message || 'Aadhaar Verification Successful'
            };
          } else {
            logger.warn('⚠️ [Cashfree] Aadhaar OTP verification failed', {
              refId,
              status: data.status,
              message: data.message
            });

            return {
              success: false,
              status: 'failed',
              message: data.message || 'Verification failed',
              refId: data.ref_id
            };
          }
        } catch (error) {
          logger.error('❌ [Cashfree] OTP verification error', {
            error: error.message,
            refId,
            response: error.response?.data,
            status: error.response?.status
          });

          // Extract error message from response
          const errorMessage = error.response?.data?.message 
            || error.response?.data?.error 
            || error.message 
            || 'Failed to verify OTP';

          // Re-throw with original axios error for proper categorization
          if (error.response) {
            throw error;
          }
          throw new Error(errorMessage);
        }
      },
      {
        maxRetries: 2, // Fewer retries for OTP verification (user is waiting)
        initialDelay: 500,
        onRetry: (attempt, error, delay) => {
          logger.warn('🔄 [Cashfree] Retrying OTP verification', {
            attempt,
            errorCode: error.code,
            nextDelay: delay
          });
        }
      }
    );
  }

  /**
   * Resend OTP for Aadhaar verification
   * @param {string} refId - Reference ID from generateAadhaarOTP
   * @returns {Promise<{success: boolean, refId?: string, message?: string}>}
   */
  async resendAadhaarOTP(refId) {
    if (!refId) {
      throw new Error('refId is required');
    }

    logger.info('🔄 [Cashfree] Resending Aadhaar OTP', {
      refId,
      environment: this.environment
    });

    // Note: Cashfree uses the same endpoint as generate OTP with ref_id parameter
    return await retryWithBackoff(
      async () => {
        try {
          const response = await axios.post(
            `${this.baseUrl}/offline-aadhaar/otp`,
            {
              ref_id: refId
            },
            {
              headers: this.getHeaders(),
              timeout: 30000
            }
          );

          if (response.data && response.data.ref_id) {
            logger.info('✅ [Cashfree] Aadhaar OTP resent successfully', {
              refId: response.data.ref_id
            });

            return {
              success: true,
              refId: response.data.ref_id,
              message: response.data.message || 'OTP resent successfully'
            };
          } else {
            throw new Error('Invalid response from Cashfree API');
          }
        } catch (error) {
          logger.error('❌ [Cashfree] OTP resend error', {
            error: error.message,
            refId,
            response: error.response?.data,
            status: error.response?.status
          });

          // Extract error message from response
          const errorMessage = error.response?.data?.message 
            || error.response?.data?.error 
            || error.message 
            || 'Failed to resend OTP';

          // Re-throw with original axios error for proper categorization
          if (error.response) {
            throw error;
          }
          throw new Error(errorMessage);
        }
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        onRetry: (attempt, error, delay) => {
          logger.warn('🔄 [Cashfree] Retrying OTP resend', {
            attempt,
            errorCode: error.code,
            nextDelay: delay
          });
        }
      }
    );
  }

  // =====================================================
  // PAN VERIFICATION (READY - FEATURE FLAG REQUIRED)
  // =====================================================

  /**
   * Verify PAN card (Verify PAN Sync - live/sandbox)
   * @param {string} panNumber - PAN number (e.g., ABCDE1234F)
   * @param {string} [name] - Optional name as per PAN (for name_match in response)
   * @returns {Promise<{success: boolean, data?: object, message?: string}>}
   */
  async verifyPAN(panNumber, name) {
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber)) {
      throw new Error('Invalid PAN format');
    }

    logger.info('🔄 [Cashfree] Verifying PAN', {
      pan: this.maskPAN(panNumber),
      environment: this.environment
    });

    // In sandbox mode, use test data
    if (this.isSandbox()) {
      const validPANs = ['ABCPV1234D', 'XYZP4321W', 'AZJPG7110R', 'ABCCD8000T', 'XYZH2000L', 'AAAHU4383C', 'AMJCL2021N', 'NVRPK6324Q'];
      const isValid = validPANs.includes(panNumber) || /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber);

      if (isValid) {
        return {
          success: true,
          data: {
            name: name || (panNumber === 'NVRPK6324Q' ? 'PAVAN KUMAR' : 'JOHN DOE'),
            panNumber: panNumber,
            maskedPAN: this.maskPAN(panNumber),
            status: 'VALID',
            referenceId: 161
          }
        };
      }
      return {
        success: false,
        message: 'Invalid PAN number',
        data: null
      };
    }

    // Production: Call Cashfree Verify PAN API (POST /pan) with retry for 429/5xx
    const body = { pan: panNumber };
    if (name && String(name).trim()) {
      body.name = String(name).trim();
    }

    try {
      return await retryWithBackoff(
        async () => {
          const response = await axios.post(
            `${this.baseUrl}/pan`,
            body,
            { headers: this.getPanHeaders(), timeout: 30000 }
          );

          const data = response.data;
          const valid = data.valid === true;

          if (!valid) {
            return {
              success: false,
              message: data.message || 'Invalid PAN',
              data: null
            };
          }

          const displayName = data.registered_name || data.name_provided || data.name_pan_card;
          return {
            success: true,
            data: {
              name: displayName || '—',
              panNumber: data.pan || panNumber,
              maskedPAN: this.maskPAN(data.pan || panNumber),
              status: data.pan_status || 'VALID',
              referenceId: data.reference_id
            }
          };
        },
        { maxRetries: 3, initialDelay: 1000, backoffMultiplier: 2 }
      );
    } catch (error) {
      logger.error('❌ [Cashfree] PAN verification error', {
        error: error.message,
        status: error.statusCode || error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  // =====================================================
  // GSTIN VERIFICATION (PRODUCTION - CASHFREE /gstin)
  // =====================================================

  /**
   * Verify GSTIN (Cashfree Verification Suite - live/sandbox)
   * @param {string} gstin - 15-character GSTIN (e.g., 29AAICP2912R1ZR)
   * @param {string} [businessName] - Optional business/trade name for matching
   * @returns {Promise<{success: boolean, data?: object, message?: string}>}
   */
  async verifyGSTIN(gstin, businessName) {
    const cleanedGstin = String(gstin || '').replace(/[\s-]/g, '').trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(cleanedGstin)) {
      throw new Error('Invalid GSTIN format');
    }

    logger.info('🔄 [Cashfree] Verifying GSTIN', {
      gstin: this.maskGSTIN(cleanedGstin),
      environment: this.environment
    });

    // In sandbox mode, use test data
    if (this.isSandbox()) {
      const validGSTINs = ['29AAICP2912R1ZR', '27AABCU9603R1ZN', '36AAACB8506M1ZP', '07AAAAA0000A1Z5'];
      const isValid = validGSTINs.includes(cleanedGstin);

      if (isValid) {
        return {
          success: true,
          data: {
            gstin: cleanedGstin,
            legalName: businessName || 'EXTRAHAND ENTERPRISES PRIVATE LIMITED',
            tradeName: businessName || 'EXTRAHAND STORE',
            status: 'Active',
            taxpayerType: 'Regular',
            registrationDate: '01/07/2017',
            stateCode: cleanedGstin.substring(0, 2),
            maskedGSTIN: this.maskGSTIN(cleanedGstin),
            referenceId: 162
          }
        };
      }
      return {
        success: false,
        message: 'Invalid GSTIN number',
        data: null
      };
    }

    // Production: Call Cashfree Verify GSTIN API (POST /gstin) with retry for 429/5xx
    const body = {
      GSTIN: cleanedGstin
    };
    if (businessName && String(businessName).trim()) {
      body.business_name = String(businessName).trim();
    }

    try {
      return await retryWithBackoff(
        async () => {
          const response = await axios.post(
            `${this.baseUrl}/gstin`,
            body,
            { headers: this.getPanHeaders(), timeout: 30000 }
          );

          const data = response.data;
          const valid = data.valid === true || data.status === 'VALID' || (data.gstin_status && data.gstin_status.toLowerCase() === 'active');

          if (!valid) {
            return {
              success: false,
              message: data.message || 'Invalid GSTIN',
              data: null
            };
          }

          const legalName = data.legal_name || data.registered_name || data.business_name || data.trade_name;
          const tradeName = data.trade_name || data.business_name || legalName;

          return {
            success: true,
            data: {
              gstin: data.gstin || data.GSTIN || cleanedGstin,
              legalName: legalName || '—',
              tradeName: tradeName || '—',
              status: data.gstin_status || data.status || 'Active',
              taxpayerType: data.taxpayer_type,
              registrationDate: data.registration_date,
              stateCode: data.state_code || cleanedGstin.substring(0, 2),
              address: data.principal_place_address || data.address,
              maskedGSTIN: this.maskGSTIN(data.gstin || cleanedGstin),
              referenceId: data.reference_id || data.verification_id
            }
          };
        },
        { maxRetries: 3, initialDelay: 1000, backoffMultiplier: 2 }
      );
    } catch (error) {
      logger.error('❌ [Cashfree] GSTIN verification error', {
        error: error.message,
        status: error.statusCode || error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  // =====================================================
  // BANK VERIFICATION (READY - FEATURE FLAG REQUIRED)
  // =====================================================

  /**
   * Verify bank account
   * @param {string} accountNumber - Bank account number
   * @param {string} ifsc - IFSC code
   * @param {string} accountHolderName - Account holder name (optional, for name matching)
   * @returns {Promise<{success: boolean, data?: object, message?: string}>}
   */
  async verifyBankAccount(accountNumber, ifsc, accountHolderName) {
    logger.info('🔄 [Cashfree] Verifying Bank Account', {
      account: this.maskBankAccount(accountNumber),
      ifsc,
      environment: this.environment
    });

    // In sandbox mode, use test data
    if (this.isSandbox()) {
      const validAccounts = {
        '026291800001191': { ifsc: 'YESB0000262', name: 'JOHN DOE', bank: 'Yes Bank', branch: 'Mumbai' },
        '00011020001772': { ifsc: 'HDFC0000001', name: 'JANE DOE', bank: 'HDFC Bank', branch: 'Delhi' },
        '000890289871772': { ifsc: 'SCBL0036078', name: 'BOB SMITH', bank: 'Standard Chartered', branch: 'Bangalore' },
      };
      
      const accountInfo = validAccounts[accountNumber];
      const isValid = accountInfo && accountInfo.ifsc === ifsc;
      
      logger.info(`✅ [Cashfree] Bank verification (sandbox)`, {
        account: this.maskBankAccount(accountNumber),
        isValid
      });

      if (isValid) {
        return {
          success: true,
          data: {
            accountHolderName: accountHolderName || accountInfo.name,
            accountNumber: accountNumber,
            maskedBankAccount: this.maskBankAccount(accountNumber),
            ifsc: ifsc,
            bankName: accountInfo.bank,
            branch: accountInfo.branch,
            status: 'VALID',
            referenceId: 'sandbox_' + Date.now(),
          }
        };
      } else {
        return {
          success: false,
          message: 'Invalid bank account or IFSC',
          data: null
        };
      }
    }

    // Production: Call actual Cashfree API with retry logic
    const body = {
      bank_account: accountNumber,
      account_number: accountNumber,
      ifsc: ifsc,
      ifsc_code: ifsc,
    };
    if (accountHolderName && String(accountHolderName).trim()) {
      body.name = String(accountHolderName).trim();
    }

    try {
      return await retryWithBackoff(
        async () => {
          let response;
          try {
            // Attempt V2 endpoint first: /bank-account/sync
            response = await axios.post(
              `${this.baseUrl}/bank-account/sync`,
              body,
              { headers: this.getHeaders(), timeout: 30000 }
            );
          } catch (v2Error) {
            // Fallback to /bank-account/verify if /bank-account/sync returns 404
            if (v2Error.response?.status === 404) {
              logger.warn('🔄 [Cashfree] /bank-account/sync 404, falling back to /bank-account/verify');
              response = await axios.post(
                `${this.baseUrl}/bank-account/verify`,
                body,
                { headers: this.getHeaders(), timeout: 30000 }
              );
            } else {
              throw v2Error;
            }
          }

          const resData = response.data?.data || response.data || {};
          const statusValue = (
            resData.account_status ||
            resData.accountStatus ||
            resData.account_status_code ||
            resData.accountStatusCode ||
            resData.status ||
            response.data?.status ||
            ''
          ).toUpperCase();
          const isValid =
            statusValue === 'VALID' ||
            statusValue === 'ACCOUNT_IS_VALID' ||
            statusValue === 'SUCCESS' ||
            resData.accountExists === 'YES' ||
            resData.account_exists === 'YES';

          if (!isValid) {
            return {
              success: false,
              message: response.data?.message || resData.message || 'Bank account is invalid or does not exist',
              data: null
            };
          }

          const verifiedName =
            resData.name_at_bank ||
            resData.nameAtBank ||
            resData.account_holder_name ||
            resData.accountHolderName ||
            accountHolderName;
          const verifiedBankName =
            resData.bank_name ||
            resData.bankName ||
            resData.ifsc_details?.bank;
          const refId =
            resData.reference_id ||
            resData.bvRefId ||
            resData.refId ||
            response.data?.reference_id ||
            response.data?.subCode;

          return {
            success: true,
            data: {
              accountNumber: resData.bank_account || resData.bankAccount || resData.account_number || accountNumber,
              maskedBankAccount: this.maskBankAccount(accountNumber),
              accountHolderName: verifiedName,
              ifsc: resData.ifsc || resData.ifsc_code || resData.ifsc_details?.ifsc || ifsc,
              bankName: verifiedBankName,
              branch: resData.branch || resData.ifsc_details?.branch,
              city: resData.city || resData.ifsc_details?.city,
              status: 'VALID',
              nameMatchScore: resData.name_match_score || resData.nameMatchScore,
              nameMatchResult: resData.name_match_result || resData.nameMatchResult,
              referenceId: refId
            }
          };
        },
        { maxRetries: 3, initialDelay: 1000, backoffMultiplier: 2 }
      );
    } catch (error) {
      logger.error('❌ [Cashfree] Bank verification error', {
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message || 'Bank account verification failed';
      return {
        success: false,
        message: errorMsg,
        data: null
      };
    }
  }
}

module.exports = CashfreeProvider;

