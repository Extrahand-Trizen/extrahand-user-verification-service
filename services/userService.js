const axios = require('axios');
const logger = require('../config/logger');

/**
 * User Service Client
 * Handles communication with the User Service to update user profiles
 */
class UserService {
  constructor() {
    this.baseURL = process.env.USER_SERVICE_URL || 'http://srv-captain--extrahand-user-service:4001';
    this.serviceAuthToken = process.env.SERVICE_AUTH_TOKEN;
    this.timeout = 10000; // 10 seconds
    
    if (!this.serviceAuthToken) {
      logger.warn('⚠️ SERVICE_AUTH_TOKEN not set - user service calls will fail');
    }
  }

  /**
   * Update user profile with Aadhaar verification status
   * @param {string} userId - User ID (uid)
   * @param {Object} verificationData - Verification data to update
   * @returns {Promise<Object>} Response from user service
   */
  async updateAadhaarVerificationStatus(userId, verificationData = {}) {
    try {
      if (!this.serviceAuthToken) {
        throw new Error('SERVICE_AUTH_TOKEN not configured');
      }

      // ✨ FIX: Use PATCH /api/v1/profiles/:uid/verification/aadhaar endpoint with service auth
      // This is the correct endpoint for service-to-service Aadhaar verification updates
      const url = `${this.baseURL}/api/v1/profiles/${userId}/verification/aadhaar`;
      
      const requestPayload = {
        isAadhaarVerified: true,
        aadhaarVerifiedAt: new Date().toISOString(),
        ...verificationData
      };
      
      logger.info('📞 [USER SERVICE] Calling User Service to update Aadhaar verification', {
        userId,
        url,
        method: 'PATCH',
        payload: requestPayload,
        headers: {
          'X-Service-Auth': '***',
          'X-Service-Name': 'verification-service',
          'X-User-Id': userId
        }
      });

      // ✨ FIX: Use PATCH method (not PUT) for the verification endpoint
      const response = await axios.patch(
        url,
        requestPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'verification-service',
            'X-User-Id': userId,
            // Add Authorization header with service token for service-to-service auth
            'Authorization': `Bearer ${this.serviceAuthToken}`
          },
          timeout: this.timeout
        }
      );

      logger.info('✅ [USER SERVICE] User Service updated Aadhaar verification status', {
        userId,
        status: response.status,
        statusText: response.statusText,
        responseData: response.data
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('❌ [USER SERVICE] Failed to update User Service with Aadhaar verification', {
        userId,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        requestUrl: url,
        requestPayload: requestPayload
      });

      // Don't throw - log and return failure so verification can still succeed
      return {
        success: false,
        error: error.message,
        status: error.response?.status
      };
    }
  }

  /**
   * Update user profile with Bank verification status
   * @param {string} userId - User ID (uid)
   * @param {Object} verificationData - Verification data to update
   * @returns {Promise<Object>} Response from user service
   */
  async updateBankVerificationStatus(userId, verificationData = {}) {
    try {
      if (!this.serviceAuthToken) {
        throw new Error('SERVICE_AUTH_TOKEN not configured');
      }

      const url = `${this.baseURL}/api/v1/profiles/${userId}/verification/bank`;
      
      const requestPayload = {
        isBankVerified: true,
        bankVerifiedAt: new Date().toISOString(),
        ...verificationData
      };
      
      logger.info('📞 [USER SERVICE] Calling User Service to update bank verification', {
        userId,
        url,
        method: 'PATCH',
        payload: requestPayload
      });

      const response = await axios.patch(
        url,
        requestPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'verification-service',
            'X-User-Id': userId,
            'Authorization': `Bearer ${this.serviceAuthToken}`
          },
          timeout: this.timeout
        }
      );

      logger.info('✅ [USER SERVICE] User Service updated bank verification status', {
        userId,
        status: response.status,
        responseData: response.data
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('❌ [USER SERVICE] Failed to update User Service with bank verification', {
        userId,
        error: error.message,
        status: error.response?.status,
        responseData: error.response?.data
      });

      return {
        success: false,
        error: error.message,
        status: error.response?.status
      };
    }
  }

  /**
   * Get user profile to check current verification status
   * @param {string} userId - User ID (uid)
   * @returns {Promise<Object>} User profile data
   */
  async getUserProfile(userId) {
    try {
      if (!this.serviceAuthToken) {
        throw new Error('SERVICE_AUTH_TOKEN not configured');
      }

      const url = `${this.baseURL}/api/v1/profiles/${userId}`;
      
      const response = await axios.get(url, {
        headers: {
          'X-Service-Auth': this.serviceAuthToken,
          'X-Service-Name': 'verification-service',
          'X-User-Id': userId
        },
        timeout: this.timeout
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('❌ Failed to get user profile from User Service', {
        userId,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new UserService();

