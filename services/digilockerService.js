const axios = require('axios');
const logger = require('../config/logger');
const { getCashfreeBaseUrl } = require('../config/env');

/**
 * DigiLocker Service
 * Handles Aadhaar verification via Cashfree DigiLocker API
 *
 * Flow: Verify Account → Create URL → User completes on DigiLocker → Get Status → Get Document
 */
class DigiLockerService {
  constructor(config) {
    this.baseUrl = config.CASHFREE_BASE_URL || getCashfreeBaseUrl(config);
    this.clientId = config.CASHFREE_CLIENT_ID;
    this.clientSecret = config.CASHFREE_CLIENT_SECRET;
    this.environment = config.CASHFREE_ENV || 'sandbox';
    this.initialized = false;
  }

  /**
   * Initialize with config (called from app.js)
   */
  initialize(config) {
    this.baseUrl = config.CASHFREE_BASE_URL || getCashfreeBaseUrl(config);
    this.clientId = config.CASHFREE_CLIENT_ID;
    this.clientSecret = config.CASHFREE_CLIENT_SECRET;
    this.environment = config.CASHFREE_ENV || 'sandbox';
    this.initialized = true;

    logger.info('✅ DigiLocker Service initialized', {
      environment: this.environment,
      baseUrl: this.baseUrl,
    });
  }

  getHeaders() {
    return {
      'x-client-id': this.clientId,
      'x-client-secret': this.clientSecret,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Step 1: Verify if user has DigiLocker account
   * @param {string} verificationId - Unique ID for this verification session
   * @param {Object} options - { mobileNumber?, aadhaarNumber? }
   * @returns {Promise<Object>} Cashfree response
   */
  async verifyAccount(verificationId, { mobileNumber, aadhaarNumber } = {}) {
    if (!mobileNumber && !aadhaarNumber) {
      throw new Error('Either mobileNumber or aadhaarNumber is required');
    }

    const payload = {
      verification_id: verificationId,
      ...(mobileNumber && { mobile_number: mobileNumber }),
      ...(aadhaarNumber && { aadhaar_number: aadhaarNumber }),
    };

    logger.info('🔄 [DigiLocker] Verifying account', {
      verificationId,
      hasMobile: !!mobileNumber,
      hasAadhaar: !!aadhaarNumber,
    });

    const response = await axios.post(
      `${this.baseUrl}/digilocker/verify-account`,
      payload,
      { headers: this.getHeaders(), timeout: 30000 }
    );

    logger.info('✅ [DigiLocker] Verify account response', {
      verificationId,
      status: response.data?.status,
    });

    return response.data;
  }

  /**
   * Step 2: Create DigiLocker consent URL
   * @param {string} verificationId - Same ID from verifyAccount
   * @param {string[]} documentRequested - e.g. ['AADHAAR', 'PAN']
   * @param {string} redirectUrl - URL to redirect user after consent
   * @param {string} userFlow - 'signin' or 'signup' (from verifyAccount response)
   * @returns {Promise<Object>} Cashfree response with url
   */
  async createUrl(verificationId, documentRequested, redirectUrl, userFlow) {
    logger.info('🔄 [DigiLocker] Creating URL', {
      verificationId,
      documentRequested,
      userFlow,
    });

    const response = await axios.post(
      `${this.baseUrl}/digilocker`,
      {
        verification_id: verificationId,
        document_requested: documentRequested,
        redirect_url: redirectUrl,
        user_flow: userFlow,
      },
      { headers: this.getHeaders(), timeout: 30000 }
    );

    logger.info('✅ [DigiLocker] URL created', {
      verificationId,
      hasUrl: !!response.data?.url,
    });

    return response.data;
  }

  /**
   * Step 3: Get verification status (poll until AUTHENTICATED)
   * @param {string} verificationId
   * @returns {Promise<Object>} Cashfree response
   */
  async getStatus(verificationId) {
    const response = await axios.get(
      `${this.baseUrl}/digilocker?verification_id=${encodeURIComponent(verificationId)}`,
      { headers: this.getHeaders(), timeout: 30000 }
    );

    return response.data;
  }

  /**
   * Step 4: Get document (Aadhaar, PAN, etc.)
   * @param {string} verificationId
   * @param {string} documentType - 'AADHAAR', 'PAN', 'DRIVING_LICENSE'
   * @returns {Promise<Object>} Cashfree response with document data
   */
  async getDocument(verificationId, documentType) {
    logger.info('🔄 [DigiLocker] Fetching document', {
      verificationId,
      documentType,
    });

    const response = await axios.get(
      `${this.baseUrl}/digilocker/document/${documentType}?verification_id=${encodeURIComponent(verificationId)}`,
      { headers: this.getHeaders(), timeout: 30000 }
    );

    logger.info('✅ [DigiLocker] Document fetched', {
      verificationId,
      documentType,
      status: response.data?.status,
    });

    return response.data;
  }
}

// Singleton instance - must call initialize(env) from app.js
const digilockerService = new DigiLockerService({});

module.exports = digilockerService;
