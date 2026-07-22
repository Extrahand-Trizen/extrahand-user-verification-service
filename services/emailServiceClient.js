const axios = require('axios');

/**
 * EmailServiceClient
 * 
 * HTTP-based client for calling email-service APIs
 * Handles all verification-related email notifications
 */
class EmailServiceClient {
  static baseURL = process.env.EMAIL_SERVICE_URL || 'http://localhost:4007';
  static serviceAuthToken = process.env.SERVICE_AUTH_TOKEN || '';
  static serviceName = 'verification-service';
  static isInitialized = false;

  /**
   * Initialize EmailServiceClient with required config
   */
  static initialize(baseURL) {
    this.baseURL = baseURL || process.env.EMAIL_SERVICE_URL || 'http://localhost:4007';
    this.serviceAuthToken = process.env.SERVICE_AUTH_TOKEN || '';
    this.isInitialized = true;

    console.log('[EmailServiceClient] Initialized', {
      baseURL: this.baseURL,
      hasAuthToken: !!this.serviceAuthToken
    });
  }

  static ensureInitialized() {
    if (!this.isInitialized) {
      this.initialize();
    }
  }

  /**
   * Validate email address before sending
   * Prevents sending to placeholder/reserved addresses (RFC 2606)
   */
  static isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;
    
    const reservedDomains = ['example.com', 'example.net', 'example.org', 'test', 'localhost', 'invalid'];
    const domain = email.split('@')[1]?.toLowerCase();
    if (reservedDomains.some(reserved => domain === reserved || domain?.endsWith(`.${reserved}`))) {
      console.warn('[EmailServiceClient] Skipping email to reserved domain', { email, domain });
      return false;
    }
    
    return true;
  }

  static async sendRequest(endpoint, data) {
    this.ensureInitialized();

    const email = data.to || data.email;
    if (!this.isValidEmail(email)) {
      console.warn('[EmailServiceClient] Skipping invalid email', { email, endpoint });
      return false;
    }

    try {
      console.log('[EmailServiceClient] Sending email request', { 
        endpoint, 
        to: email 
      });

      await axios.post(
        `${this.baseURL}/api/v1/email${endpoint}`,
        data,
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log('[EmailServiceClient] Email request successful', { endpoint });
      return true;
    } catch (error) {
      console.error('[EmailServiceClient] Failed to send email', {
        endpoint,
        status: error.response?.status,
        message: error.message
      });
      return false;
    }
  }

  // ============ Verification Emails ============

  /**
   * Send email verification OTP
   */
  static async sendEmailVerification(email, otp, verificationLink, userName, expiresAt) {
    return this.sendRequest('/send', {
      to: email,
      subject: '📧 Verify Your Email Address - ExtraHand',
      template: 'email_verification',
      data: {
        name: userName || 'User',
        otp,
        verificationLink,
        expiresAt: expiresAt?.toLocaleString?.() || expiresAt
      }
    });
  }

  /**
   * Send verification request (prompt to upload documents)
   */
  static async sendVerificationRequest(email, userName, requiredDocuments, verificationUrl) {
    return this.sendRequest('/send', {
      to: email,
      subject: '📋 Complete Your Verification - ExtraHand',
      template: 'verification_request',
      data: {
        userName,
        requiredDocuments: requiredDocuments || ['Aadhaar Card', 'PAN Card', 'Bank Account Details'],
        verificationUrl: verificationUrl || 'https://extrahand.in/settings/verification'
      }
    });
  }

  /**
   * Send verification approved notification
   */
  static async sendVerificationApproved(email, userName, verificationType) {
    return this.sendRequest('/send', {
      to: email,
      subject: '✅ Verification Approved - ExtraHand',
      template: 'verification_approved',
      data: {
        userName,
        verificationType
      }
    });
  }

  /**
   * Send verification rejected notification
   */
  static async sendVerificationRejected(email, userName, verificationType, rejectionReason, verificationUrl) {
    return this.sendRequest('/send', {
      to: email,
      subject: '⚠️ Verification Needs Correction - ExtraHand',
      template: 'verification_rejected',
      data: {
        userName,
        verificationType,
        rejectionReason,
        verificationUrl: verificationUrl || 'https://extrahand.in/settings/verification'
      }
    });
  }

  /**
   * Send document upload reminder
   */
  static async sendDocumentReminder(email, userName, pendingDocuments, verificationUrl) {
    return this.sendRequest('/send', {
      to: email,
      subject: '📄 Reminder: Complete Your Document Upload - ExtraHand',
      template: 'document_reminder',
      data: {
        userName,
        pendingDocuments,
        verificationUrl: verificationUrl || 'https://extrahand.in/settings/verification'
      }
    });
  }

  /**
   * Send verification status update (generic - Aadhaar/PAN/Bank)
   */
  static async sendVerificationStatus(
    email,
    userName,
    verificationType,
    status,
    statusText,
    rejectionReason,
    verificationUrl
  ) {
    const subject = `${verificationType} Verification ${status === 'approved' ? '✅ Approved' : status === 'rejected' ? '⚠️ Needs Attention' : 'Update'} - ExtraHand`;
    
    return this.sendRequest('/send', {
      to: email,
      subject,
      template: 'verification_status',
      data: {
        userName,
        verificationType,
        status,
        statusText,
        rejectionReason,
        verificationUrl: verificationUrl || 'https://extrahand.in/settings/verification'
      }
    });
  }

  /**
   * Send Aadhaar verification status
   */
  static async sendAadhaarStatus(email, userName, status, rejectionReason) {
    return this.sendVerificationStatus(
      email,
      userName,
      'Aadhaar',
      status,
      status === 'approved' ? 'Verified' : status === 'rejected' ? 'Rejected' : 'Processing',
      rejectionReason
    );
  }

  /**
   * Send PAN verification status
   */
  static async sendPanStatus(email, userName, status, rejectionReason) {
    return this.sendVerificationStatus(
      email,
      userName,
      'PAN',
      status,
      status === 'approved' ? 'Verified' : status === 'rejected' ? 'Rejected' : 'Processing',
      rejectionReason
    );
  }

  /**
   * Send Bank verification status
   */
  static async sendBankStatus(email, userName, status, rejectionReason) {
    return this.sendVerificationStatus(
      email,
      userName,
      'Bank Account',
      status,
      status === 'approved' ? 'Verified' : status === 'rejected' ? 'Rejected' : 'Processing',
      rejectionReason
    );
  }
}

module.exports = { EmailServiceClient };
