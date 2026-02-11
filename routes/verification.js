const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Verification = require('../models/Verification');
const KycSession = require('../models/KycSession');
const { getVerificationProvider } = require('../services/providerFactory');
const digilockerService = require('../services/digilockerService');
const { serviceAuthMiddleware } = require('../middleware/auth');
const userService = require('../services/userService');
const { isValidAadhaarFormat, cleanAadhaarNumber, maskAadhaar } = require('../utils/validation');
const { successResponse, errorResponse, getClientIp } = require('../utils/helpers');
const logger = require('../config/logger');
const axios = require('axios');

// =====================================================
// FEATURE FLAGS
// =====================================================
const FEATURES = {
  AADHAAR: process.env.FEATURE_AADHAAR !== 'false', // ✅ ENABLED by default
  PAN: process.env.FEATURE_PAN === 'true',          // 🔒 DISABLED (ready to enable)
  BANK: process.env.FEATURE_BANK === 'true',        // 🔒 DISABLED (ready to enable)
  FACE: process.env.FEATURE_FACE === 'true',        // 🔒 DISABLED (ready to enable)
  LIVENESS: process.env.FEATURE_LIVENESS === 'true', // 🔒 DISABLED (ready to enable)
};

logger.info('🎌 Feature flags initialized', FEATURES);

// =====================================================
// FEATURE AVAILABILITY ENDPOINT
// =====================================================

/**
 * GET /api/v1/verification/features
 * Return which features are currently enabled
 */
router.get('/features', (req, res) => {
  res.json({
    success: true,
    features: FEATURES,
    message: 'Available verification features',
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// AADHAAR VERIFICATION (DigiLocker)
// =====================================================

/**
 * POST /api/v1/verification/aadhaar/digilocker/initiate
 * Step 1+2: Verify Account + Create URL
 * Returns DigiLocker URL for user to complete verification
 */
router.post('/aadhaar/digilocker/initiate', serviceAuthMiddleware, async (req, res) => {
  try {
    if (!FEATURES.AADHAAR) {
      return res.status(503).json(errorResponse(
        'Aadhaar verification is temporarily disabled',
        'This feature is currently unavailable',
        'FEATURE_DISABLED'
      ));
    }

    const userId = req.headers['x-user-id'] || req.body.userId;
    const { mobileNumber, aadhaarNumber, consentGiven } = req.body;

    if (!userId) {
      return res.status(400).json(errorResponse('Missing required field: userId', 'User ID is required'));
    }

    if (!mobileNumber && !aadhaarNumber) {
      return res.status(400).json(errorResponse(
        'Either mobileNumber or aadhaarNumber is required',
        'Please provide mobile number or Aadhaar number'
      ));
    }

    if (!consentGiven) {
      return res.status(400).json(errorResponse(
        'User consent required',
        'User consent is required for Aadhaar verification'
      ));
    }

    // Validate Aadhaar format if provided
    if (aadhaarNumber) {
      const cleaned = cleanAadhaarNumber(aadhaarNumber);
      if (!isValidAadhaarFormat(cleaned)) {
        return res.status(400).json(errorResponse(
          'Invalid Aadhaar number format',
          'Aadhaar number must be exactly 12 digits'
        ));
      }
    }

    const redirectUrl = process.env.DIGILOCKER_REDIRECT_URL;
    if (!redirectUrl) {
      return res.status(500).json(errorResponse(
        'DIGILOCKER_REDIRECT_URL not configured',
        'DigiLocker redirect URL is not configured. Please contact support.'
      ));
    }

    // Check if already verified
    try {
      const userProfile = await userService.getUserProfile(userId);
      const profile = userProfile.data?.profile || userProfile.data;
      if (userProfile.success && profile?.isAadhaarVerified === true) {
        return res.status(200).json(successResponse({
          alreadyVerified: true,
          status: 'verified',
          maskedAadhaar: profile.maskedAadhaar,
          verifiedAt: profile.aadhaarVerifiedAt
        }, 'Aadhaar is already verified'));
      }
    } catch (e) {
      logger.warn('Could not check User Service', { userId, error: e.message });
    }

    const aadhaarVerification = await Verification.findByUserIdAndType(userId, 'aadhaar');
    if (aadhaarVerification?.status === 'verified') {
      return res.status(200).json(successResponse({
        alreadyVerified: true,
        status: 'verified',
        maskedAadhaar: aadhaarVerification.maskedAadhaar,
        verifiedAt: aadhaarVerification.verifiedAt
      }, 'Aadhaar is already verified'));
    }

    const verificationId = `eh_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = new Date();
    const urlExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    // Step 1: Verify Account
    const verifyResult = await digilockerService.verifyAccount(verificationId, {
      mobileNumber: mobileNumber || undefined,
      aadhaarNumber: aadhaarNumber ? cleanAadhaarNumber(aadhaarNumber) : undefined
    });

    const userFlow = verifyResult.status === 'ACCOUNT_EXISTS' ? 'signin' : 'signup';

    // Step 2: Create URL
    const createResult = await digilockerService.createUrl(
      verificationId,
      ['AADHAAR'],
      redirectUrl,
      userFlow
    );

    // Save KycSession
    await KycSession.create({
      verification_id: verificationId,
      userId,
      sessionType: 'digilocker',
      status: 'in_progress',
      digilockerStatus: verifyResult.status,
      referenceId: verifyResult.reference_id || createResult.reference_id,
      digilockerId: verifyResult.digilocker_id,
      userFlow,
      digilockerUrl: createResult.url,
      documentRequested: ['AADHAAR'],
      redirectUrl,
      urlExpiresAt,
      documentConsent: null,
      documentConsentValidity: null,
      userDetails: {}
    });

    logger.info('✅ DigiLocker session initiated', { userId, verificationId });

    res.json(successResponse({
      verification_id: verificationId,
      url: createResult.url,
      status: 'PENDING',
      urlExpiresAt,
      message: 'Redirect user to the URL to complete verification'
    }, 'DigiLocker URL created'));
  } catch (error) {
    logger.error('❌ DigiLocker initiate error', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body?.userId
    });

    const status = error.response?.status || 500;
    const message = error.response?.data?.message || error.message || 'Failed to initiate DigiLocker verification';

    res.status(status >= 400 ? status : 500).json(errorResponse(
      message,
      'An error occurred while initiating verification'
    ));
  }
});

/**
 * GET /api/v1/verification/aadhaar/digilocker/status
 * Step 4: Get verification status (for polling)
 * Query: verification_id
 */
router.get('/aadhaar/digilocker/status', serviceAuthMiddleware, async (req, res) => {
  try {
    const verificationId = req.query.verification_id;
    const userId = req.headers['x-user-id'];

    if (!verificationId) {
      return res.status(400).json(errorResponse(
        'Missing verification_id',
        'verification_id query parameter is required'
      ));
    }

    const session = await KycSession.findByVerificationId(verificationId);
    if (!session) {
      return res.status(404).json(errorResponse(
        'Session not found',
        'No DigiLocker session found for this verification ID'
      ));
    }

    if (userId && session.userId !== userId) {
      return res.status(403).json(errorResponse(
        'Forbidden',
        'This session does not belong to you'
      ));
    }

    const statusResult = await digilockerService.getStatus(verificationId);

    // Update session with latest status
    session.status = statusResult.status === 'AUTHENTICATED' ? 'in_progress' : session.status;
    session.documentConsent = statusResult.document_consent || session.documentConsent;
    session.documentConsentValidity = statusResult.document_consent_validity
      ? new Date(statusResult.document_consent_validity)
      : session.documentConsentValidity;
    session.userDetails = statusResult.user_details || session.userDetails || {};
    await session.save();

    res.json(successResponse({
      verification_id: verificationId,
      status: statusResult.status,
      document_consent: statusResult.document_consent,
      document_consent_validity: statusResult.document_consent_validity,
      user_details: statusResult.user_details,
      ready_for_complete: statusResult.status === 'AUTHENTICATED' && statusResult.user_details?.eaadhaar === 'Y'
    }, 'Status retrieved'));
  } catch (error) {
    logger.error('❌ DigiLocker status error', {
      error: error.message,
      verificationId: req.query.verification_id
    });

    res.status(500).json(errorResponse(
      error.response?.data?.message || error.message || 'Failed to get status',
      'An error occurred while fetching status'
    ));
  }
});

/**
 * POST /api/v1/verification/aadhaar/digilocker/complete
 * Step 5: Get Document + update Verification + User Service
 */
router.post('/aadhaar/digilocker/complete', serviceAuthMiddleware, async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { verification_id: verificationId } = req.body;

    if (!userId) {
      return res.status(400).json(errorResponse('Missing required field: userId', 'User ID is required'));
    }

    if (!verificationId) {
      return res.status(400).json(errorResponse(
        'Missing verification_id',
        'verification_id is required'
      ));
    }

    const session = await KycSession.findByVerificationId(verificationId);
    if (!session) {
      return res.status(404).json(errorResponse(
        'Session not found',
        'No DigiLocker session found'
      ));
    }

    if (session.userId !== userId) {
      return res.status(403).json(errorResponse('Forbidden', 'This session does not belong to you'));
    }

    if (session.status === 'completed') {
      const verification = await Verification.findByUserIdAndType(userId, 'aadhaar');
      return res.json(successResponse({
        alreadyVerified: true,
        status: 'verified',
        maskedAadhaar: verification?.maskedAadhaar,
        verifiedAt: verification?.verifiedAt
      }, 'Already verified'));
    }

    // Get Aadhaar document from Cashfree
    const docResult = await digilockerService.getDocument(verificationId, 'AADHAAR');

    if (docResult.status !== 'SUCCESS') {
      const reason = docResult.status === 'AADHAAR_NOT_LINKED'
        ? 'Aadhaar is not linked in DigiLocker. Please link Aadhaar and retry.'
        : docResult.message || 'Failed to fetch document';

      session.status = 'failed';
      session.failureReason = reason;
      await session.save();

      return res.status(400).json(errorResponse(
        reason,
        reason,
        docResult.status || 'DOCUMENT_FETCH_FAILED'
      ));
    }

    const now = new Date();
    const maskedAadhaar = docResult.uid || 'XXXX XXXX XXXX';
    const verifiedData = {
      name: docResult.name,
      yearOfBirth: docResult.year_of_birth,
      gender: docResult.gender,
      careOf: docResult.care_of,
      photoLink: docResult.photo_link,
      address: docResult.split_address
    };

    // Create or update Verification
    let verification = await Verification.findByUserIdAndType(userId, 'aadhaar');
    const verificationPayload = {
      userId,
      type: 'aadhaar',
      status: 'verified',
      provider: 'cashfree',
      verificationSource: 'self_service_api',
      maskedAadhaar,
      verifiedData,
      verifiedAt: now,
      kycSessionId: session._id,
      consent: {
        given: true,
        givenAt: session.createdAt,
        consentVersion: 'v1.0',
        consentText: 'User consented to Aadhaar verification via DigiLocker'
      },
      auditLog: [{
        action: 'verified',
        performedBy: userId,
        performedAt: now,
        metadata: { method: 'digilocker', verificationId }
      }]
    };

    if (verification) {
      Object.assign(verification, verificationPayload);
      await verification.save();
    } else {
      verification = await Verification.create(verificationPayload);
    }

    session.status = 'completed';
    session.consentExpiresAt = session.documentConsentValidity;
    await session.save();

    // Update User Service
    try {
      await userService.updateAadhaarVerificationStatus(userId, {
        isAadhaarVerified: true,
        aadhaarVerifiedAt: now.toISOString(),
        maskedAadhaar,
        verifiedData: {
          name: verifiedData.name,
          gender: verifiedData.gender,
          yearOfBirth: verifiedData.yearOfBirth
        }
      });
    } catch (updateError) {
      logger.error('Failed to update User Service (non-blocking)', {
        userId,
        error: updateError.message
      });
    }

    logger.info('✅ DigiLocker verification completed', { userId, verificationId });

    res.json(successResponse({
      status: 'verified',
      maskedAadhaar,
      verifiedData: {
        name: verifiedData.name,
        gender: verifiedData.gender,
        yearOfBirth: verifiedData.yearOfBirth
      }
    }, 'Aadhaar verification successful'));
  } catch (error) {
    logger.error('❌ DigiLocker complete error', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body?.userId
    });

    res.status(500).json(errorResponse(
      error.response?.data?.message || error.message || 'Failed to complete verification',
      'An error occurred while completing verification'
    ));
  }
});

// =====================================================
// STATUS & BADGE ROUTES
// =====================================================

/**
 * GET /api/v1/verification/status/:userId
 * Get verification status for a user
 */
router.get('/status/:userId', serviceAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const verification = await Verification.findByUserId(userId);

    if (!verification) {
      return res.json(successResponse({
        status: 'not_initiated',
        isVerified: false
      }, 'Verification not initiated'));
    }

    res.json(successResponse({
      status: verification.status,
      isVerified: verification.isVerified(),
      type: verification.type,
      maskedAadhaar: verification.maskedAadhaar,
      provider: verification.provider,
      verifiedAt: verification.verifiedAt
    }));
  } catch (error) {
    logger.error('❌ Error fetching verification status', {
      error: error.message,
      userId: req.params.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to fetch verification status',
      'An error occurred while fetching verification status'
    ));
  }
});

/**
 * GET /api/v1/verification/badge/:userId
 * Get verification badge data for display
 */
router.get('/badge/:userId', serviceAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const verification = await Verification.findByUserId(userId);

    if (!verification || !verification.isVerified()) {
      return res.json(successResponse({
        isVerified: false,
        badge: null
      }));
    }

    res.json(successResponse({
      isVerified: true,
      badge: {
        type: verification.type,
        status: verification.status,
        verifiedAt: verification.verifiedAt,
        maskedAadhaar: verification.maskedAadhaar,
        provider: verification.provider
      }
    }));
  } catch (error) {
    logger.error('❌ Error fetching verification badge', {
      error: error.message,
      userId: req.params.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to fetch verification badge',
      'An error occurred while fetching verification badge'
    ));
  }
});

// =====================================================
// FUTURE VERIFICATION ROUTES (READY - FEATURE FLAGGED)
// =====================================================

/**
 * POST /api/v1/verification/pan/verify
 * Verify PAN card - STUB (Ready to activate)
 * 
 * TO ACTIVATE:
 * 1. Set FEATURE_PAN=true in .env
 * 2. Ensure provider supports PAN (Cashfree does!)
 * 3. Uncomment implementation below
 * 4. Restart service
 */
router.post('/pan/verify', serviceAuthMiddleware, async (req, res) => {
  if (!FEATURES.PAN) {
    return res.status(503).json({
      success: false,
      message: 'PAN verification is not yet available. Contact admin to enable this feature.',
      code: 'FEATURE_NOT_ENABLED',
      timestamp: new Date().toISOString()
    });
  }

  // ✅ PAN VERIFICATION - ACTIVE
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { panNumber, name, consent } = req.body;

    if (!userId) {
      return res.status(400).json(errorResponse('Missing required field: userId', 'User ID is required'));
    }

    if (!panNumber) {
      return res.status(400).json(errorResponse('Missing required field: panNumber', 'PAN number is required'));
    }

    if (!consent?.given) {
      return res.status(400).json(errorResponse('Consent required', 'User consent is required for PAN verification'));
    }

    // Validate PAN format
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber)) {
      return res.status(400).json(errorResponse('Invalid PAN format', 'PAN must be in format: ABCDE1234F'));
    }

    logger.info('🔄 Verifying PAN', { userId, maskedPAN: panNumber.substring(0, 2) + 'XXX' + panNumber.slice(-4) });

    // ✨ NEW: Check if PAN is already verified for this user
    const existingVerification = await Verification.findOne({
      userId,
      type: 'pan',
      status: 'verified'
    });

    if (existingVerification) {
      logger.info('✅ PAN already verified for user', { userId, verificationId: existingVerification._id });
      return res.json(successResponse({
        verificationId: existingVerification._id,
        maskedPAN: existingVerification.maskedPAN,
        verifiedData: {
          name: existingVerification.verifiedData?.name
        },
        status: 'verified',
        alreadyVerified: true
      }, 'PAN is already verified'));
    }

    // Get verification provider
    const provider = getVerificationProvider(process.env);
    
    // ✨ NEW: Check if provider supports PAN verification
    if (!provider || typeof provider.verifyPAN !== 'function') {
      logger.error('❌ Provider does not support PAN verification', {
        provider: provider?.constructor?.name || 'unknown',
        hasVerifyPAN: typeof provider?.verifyPAN === 'function'
      });
      return res.status(503).json(errorResponse(
        'PAN verification not supported by current provider',
        'PAN verification is not available with the current verification provider. Please contact support.',
        'PROVIDER_NOT_SUPPORTED'
      ));
    }
    
    // Call provider to verify PAN
    logger.info('🔄 Calling provider.verifyPAN', { 
      provider: provider.constructor?.name || 'unknown',
      panMasked: panNumber.substring(0, 2) + 'XXX' + panNumber.slice(-4)
    });
    
    let result;
    try {
      result = await provider.verifyPAN(panNumber, name);
      logger.info('✅ Provider returned result', { 
        success: result?.success,
        hasData: !!result?.data
      });
    } catch (providerError) {
      logger.error('❌ Provider.verifyPAN threw error', {
        error: providerError.message,
        status: providerError.statusCode ?? providerError.response?.status,
        response: providerError.response?.data
      });
      const status = providerError.statusCode ?? providerError.response?.status ?? 500;
      const message = providerError.response?.data?.message ?? providerError.message ?? 'PAN verification failed';
      return res.status(status).json(errorResponse(message, message));
    }

    // Create or update verification record
    const now = new Date();
    
    // ✨ NEW: Check if there's an existing verification record (even if failed)
    let verification = await Verification.findOne({
      userId,
      type: 'pan'
    });

    const cashfreeReferenceId = result.data?.referenceId ?? result.data?.reference_id;

    if (verification) {
      // Update existing record
      verification.status = result.success ? 'verified' : 'failed';
      verification.maskedPAN = result.data?.maskedPAN || (panNumber.substring(0, 2) + 'XXX' + panNumber.slice(-4));
      verification.verifiedData = { 
        name: result.data?.name,
        panNumber: result.data?.panNumber,
        status: result.data?.status
      };
      if (cashfreeReferenceId != null) verification.refId = String(cashfreeReferenceId);
      verification.verifiedAt = result.success ? now : null;
      verification.failedAt = result.success ? null : now;
      verification.failureReason = result.success ? null : result.message;
      verification.auditLog.push({
        action: result.success ? 'reverified' : 'retry_failed',
        performedBy: userId,
        performedAt: now,
        ipAddress: getClientIp(req),
        metadata: {
          provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
          environment: process.env.CASHFREE_ENV || 'sandbox',
          ...(cashfreeReferenceId != null && { referenceId: cashfreeReferenceId })
        }
      });
      await verification.save();
    } else {
      // Create new verification record
      verification = await Verification.create({
      userId,
      type: 'pan',
      status: result.success ? 'verified' : 'failed',
      provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
      refId: cashfreeReferenceId != null ? String(cashfreeReferenceId) : undefined,
      maskedPAN: result.data?.maskedPAN || (panNumber.substring(0, 2) + 'XXX' + panNumber.slice(-4)),
      verifiedData: { 
        name: result.data?.name,
        panNumber: result.data?.panNumber,
        status: result.data?.status
      },
      consent: {
        given: true,
        givenAt: now,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        consentVersion: consent.version || 'v1.0',
        consentText: consent.text || 'User consented to PAN verification'
      },
      auditLog: [{
        action: 'verified',
        performedBy: userId,
        performedAt: now,
        ipAddress: getClientIp(req),
        metadata: {
          provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
          environment: process.env.CASHFREE_ENV || 'sandbox',
          ...(cashfreeReferenceId != null && { referenceId: cashfreeReferenceId })
        }
      }],
      verifiedAt: result.success ? now : null,
      failedAt: result.success ? null : now,
      failureReason: result.success ? null : result.message,
      metadata: {
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        environment: process.env.CASHFREE_ENV || 'sandbox'
      }
      });
    }

    logger.info('✅ PAN verification completed', { 
      userId, 
      verificationId: verification._id,
      status: verification.status 
    });

    // Update User Service with PAN verification status (when successful)
    if (result.success) {
      try {
        const userServiceUpdate = await userService.updatePANVerificationStatus(userId, {
          isPANVerified: true,
          panVerifiedAt: new Date().toISOString(),
          maskedPAN: verification.maskedPAN
        });
        if (userServiceUpdate.success) {
          logger.info('✅ [VERIFICATION → USER SERVICE] User Service updated with PAN verification', { userId });
        } else {
          logger.warn('⚠️ [VERIFICATION → USER SERVICE] Failed to update User Service with PAN verification (non-blocking)', {
            userId,
            error: userServiceUpdate.error
          });
        }
      } catch (updateError) {
        logger.error('❌ [VERIFICATION → USER SERVICE] Error updating User Service for PAN (non-blocking)', {
          userId,
          error: updateError.message
        });
      }
    }

    // Send PAN verification email (non-blocking)
    if (result.success) {
      const { EmailServiceClient } = require('../services/emailServiceClient');
      // Note: Would need to fetch user email from user-service
      logger.info('Email trigger: pan_verification_approved', {
        userId,
        status: verification.status,
        maskedPAN: verification.maskedPAN,
      });
    }

    res.json(successResponse({
      verificationId: verification._id,
      maskedPAN: verification.maskedPAN,
      verifiedData: {
        name: verification.verifiedData?.name
      },
      status: verification.status,
      ...(verification.refId && { referenceId: verification.refId })
    }, result.success ? 'PAN verified successfully' : 'PAN verification failed'));

  } catch (error) {
    logger.error('❌ PAN verification error', { 
      userId: req.headers['x-user-id'],
      error: error.message,
      stack: error.stack,
      errorName: error.name,
      errorCode: error.code,
      responseData: error.response?.data
    });
    
    // Provide more informative error message
    let errorMessage = error.message || 'Failed to verify PAN';
    let userMessage = 'An error occurred while verifying PAN';
    
    // Handle specific error cases
    if (error.message?.includes('not yet enabled') || error.message?.includes('Feature flag')) {
      userMessage = 'PAN verification is not enabled. Please contact support.';
      errorMessage = 'PAN verification feature not enabled';
    } else if (error.message?.includes('Invalid PAN format')) {
      userMessage = 'Invalid PAN number format. Please check and try again.';
      errorMessage = error.message;
    } else if (error.response?.data) {
      // If it's an HTTP error from provider, use the provider's error message
      errorMessage = error.response.data.message || error.response.data.error || error.message;
      userMessage = errorMessage;
    }
    
    const errorResponseObj = errorResponse(
      errorMessage,
      userMessage,
      error.code || 'PAN_VERIFICATION_ERROR'
    );
    
    // Add development details if needed
    if (process.env.NODE_ENV === 'development') {
      errorResponseObj.details = error.message;
      errorResponseObj.stack = error.stack;
    }
    
    res.status(500).json(errorResponseObj);
  }
});

/**
 * POST /api/v1/verification/bank/verify
 * Verify bank account
 */
router.post('/bank/verify', serviceAuthMiddleware, async (req, res) => {
  if (!FEATURES.BANK) {
    return res.status(503).json({
      success: false,
      message: 'Bank account verification is not yet available. Contact admin to enable this feature.',
      code: 'FEATURE_NOT_ENABLED',
      timestamp: new Date().toISOString()
    });
  }

  // ✅ BANK VERIFICATION - ACTIVE
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { accountNumber, ifsc, accountHolderName, consent } = req.body;

    if (!userId) {
      return res.status(400).json(errorResponse('Missing required field: userId', 'User ID is required'));
    }

    if (!accountNumber || !ifsc) {
      return res.status(400).json(errorResponse('Missing required fields', 'Account number and IFSC are required'));
    }

    if (!consent?.given) {
      return res.status(400).json(errorResponse('Consent required', 'User consent is required for bank verification'));
    }

    // Basic validation
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return res.status(400).json(errorResponse('Invalid IFSC format', 'IFSC must be 11 characters (e.g., YESB0000262)'));
    }

    logger.info('🔄 Verifying Bank Account', { 
      userId, 
      maskedAccount: 'XXXX' + accountNumber.slice(-4),
      ifsc 
    });

    // Get verification provider
    const provider = getVerificationProvider(process.env);
    
    // Call provider to verify bank account
    const result = await provider.verifyBankAccount(accountNumber, ifsc, accountHolderName);

    // Create verification record
    const now = new Date();
    const verification = await Verification.create({
      userId,
      type: 'bank_account',
      status: result.success ? 'verified' : 'failed',
      provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
      maskedBankAccount: result.data?.maskedBankAccount || ('XXXX' + accountNumber.slice(-4)),
      verifiedData: { 
        accountHolderName: result.data?.accountHolderName || accountHolderName,
        ifsc: ifsc,
        bankName: result.data?.bankName,
        branch: result.data?.branch,
        status: result.data?.status
      },
      consent: {
        given: true,
        givenAt: now,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        consentVersion: consent.version || 'v1.0',
        consentText: consent.text || 'User consented to bank account verification'
      },
      auditLog: [{
        action: 'verified',
        performedBy: userId,
        performedAt: now,
        ipAddress: getClientIp(req),
        metadata: {
          provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
          environment: process.env.CASHFREE_ENV || 'sandbox'
        }
      }],
      verifiedAt: result.success ? now : null,
      failedAt: result.success ? null : now,
      failureReason: result.success ? null : result.message,
      metadata: {
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        environment: process.env.CASHFREE_ENV || 'sandbox'
      }
    });

    logger.info('✅ Bank account verification completed', { 
      userId, 
      verificationId: verification._id,
      status: verification.status 
    });

    // ✨ Update User Service with bank verification status
    logger.info('📞 [VERIFICATION → USER SERVICE] Calling User Service to update bank verification status', {
      userId,
      maskedBankAccount: verification.maskedBankAccount,
      verifiedData: verification.verifiedData
    });
    
    console.log('🔍 [DEBUG] Verification data before user-service call:', {
      'verification.verifiedData': verification.verifiedData,
      'verification.verifiedData.accountHolderName': verification.verifiedData?.accountHolderName,
      'verification.verifiedData.bankName': verification.verifiedData?.bankName,
      'verification.verifiedData.ifsc': verification.verifiedData?.ifsc
    });
    
    try {
      console.log('🔍 [DEBUG] About to call userService.updateBankVerificationStatus', {
        userId,
        USER_SERVICE_URL: process.env.USER_SERVICE_URL,
        SERVICE_AUTH_TOKEN_PRESENT: !!process.env.SERVICE_AUTH_TOKEN,
        verificationData: {
          isBankVerified: true,
          bankVerifiedAt: new Date().toISOString(),
          maskedBankAccount: verification.maskedBankAccount,
          bankAccount: {
            accountHolderName: verification.verifiedData?.accountHolderName,
            bankName: verification.verifiedData?.bankName,
            ifsc: verification.verifiedData?.ifsc
          }
        }
      });
      
      const userServiceUpdate = await userService.updateBankVerificationStatus(userId, {
        isBankVerified: true,
        bankVerifiedAt: new Date().toISOString(),
        maskedBankAccount: verification.maskedBankAccount,
        bankAccount: {
          accountHolderName: verification.verifiedData?.accountHolderName,
          bankName: verification.verifiedData?.bankName,
          ifsc: verification.verifiedData?.ifsc
        }
      });

      if (userServiceUpdate.success) {
        logger.info('✅ [VERIFICATION → USER SERVICE] User Service updated with bank verification', { 
          userId,
          responseData: userServiceUpdate.data
        });
      } else {
        logger.warn('⚠️ [VERIFICATION → USER SERVICE] Failed to update User Service, but verification succeeded', {
          userId,
          error: userServiceUpdate.error,
          status: userServiceUpdate.status
        });
      }
    } catch (updateError) {
      // Log but don't fail the verification response
      logger.error('❌ [VERIFICATION → USER SERVICE] Error updating User Service (non-blocking)', {
        userId,
        error: updateError.message,
        stack: updateError.stack,
        note: 'Bank verification succeeded but profile update failed'
      });
    }

    res.json(successResponse({
      verificationId: verification._id,
      maskedBankAccount: verification.maskedBankAccount,
      verifiedData: {
        accountHolderName: verification.verifiedData?.accountHolderName,
        bankName: verification.verifiedData?.bankName,
        ifsc: verification.verifiedData?.ifsc
      },
      status: verification.status
    }, 'Bank account verified successfully'));

  } catch (error) {
    logger.error('❌ Bank verification error', { 
      userId: req.headers['x-user-id'],
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json(errorResponse(
      error.message || 'Failed to verify bank account',
      'An error occurred while verifying bank account'
    ));
  }
});

/**
 * POST /api/v1/verification/face/match
 * Face matching verification
 */
router.post('/face/match', serviceAuthMiddleware, async (req, res) => {
  if (!FEATURES.FACE) {
    return res.status(503).json({
      success: false,
      message: 'Face verification is not yet available. Contact admin to enable this feature.',
      code: 'FEATURE_NOT_ENABLED',
      timestamp: new Date().toISOString()
    });
  }

  // ✅ FACE MATCH VERIFICATION - ACTIVE (Mock implementation for testing)
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { selfieImage, documentImage, consent } = req.body;

    if (!userId) {
      return res.status(400).json(errorResponse('Missing required field: userId', 'User ID is required'));
    }

    if (!selfieImage || !documentImage) {
      return res.status(400).json(errorResponse('Missing required fields', 'Selfie and document images are required'));
    }

    if (!consent?.given) {
      return res.status(400).json(errorResponse('Consent required', 'User consent is required for face verification'));
    }

    logger.info('🔄 Performing Face Match', { userId });

    // Get verification provider
    const provider = getVerificationProvider(process.env);
    
    // Call provider to verify face match
    const result = await provider.verifyFaceMatch(selfieImage, documentImage);

    // Create verification record
    const now = new Date();
    const verification = await Verification.create({
      userId,
      type: 'face_match',
      status: result.success ? 'verified' : 'failed',
      provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
      faceVerification: {
        matchScore: result.data?.matchScore || 0,
        threshold: result.data?.threshold || 0.7,
        matched: result.success
      },
      verifiedData: { 
        matchScore: result.data?.matchScore,
        confidence: result.data?.confidence,
        status: result.success ? 'MATCHED' : 'NOT_MATCHED'
      },
      consent: {
        given: true,
        givenAt: now,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        consentVersion: consent.version || 'v1.0',
        consentText: consent.text || 'User consented to face verification'
      },
      auditLog: [{
        action: 'face_match_verified',
        performedBy: userId,
        performedAt: now,
        ipAddress: getClientIp(req),
        metadata: {
          provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
          environment: process.env.CASHFREE_ENV || 'sandbox'
        }
      }],
      verifiedAt: result.success ? now : null,
      failedAt: result.success ? null : now,
      failureReason: result.success ? null : result.message,
      metadata: {
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        environment: process.env.CASHFREE_ENV || 'sandbox'
      }
    });

    logger.info('✅ Face match verification completed', { 
      userId, 
      verificationId: verification._id,
      status: verification.status,
      matchScore: result.data?.matchScore
    });

    res.json(successResponse({
      verificationId: verification._id,
      matchScore: result.data?.matchScore,
      confidence: result.data?.confidence,
      status: verification.status
    }, 'Face match verification completed'));

  } catch (error) {
    logger.error('❌ Face match verification error', { 
      userId: req.headers['x-user-id'],
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json(errorResponse(
      error.message || 'Failed to verify face match',
      'An error occurred while verifying face match'
    ));
  }
});

/**
 * POST /api/v1/verification/face/liveness
 * Liveness detection
 */
router.post('/face/liveness', serviceAuthMiddleware, async (req, res) => {
  if (!FEATURES.LIVENESS) {
    return res.status(503).json({
      success: false,
      message: 'Liveness detection is not yet available. Contact admin to enable this feature.',
      code: 'FEATURE_NOT_ENABLED',
      timestamp: new Date().toISOString()
    });
  }

  // ✅ LIVENESS DETECTION - ACTIVE (Mock implementation for testing)
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { videoData, verificationId, consent } = req.body;

    if (!userId) {
      return res.status(400).json(errorResponse('Missing required field: userId', 'User ID is required'));
    }

    if (!videoData && !verificationId) {
      return res.status(400).json(errorResponse('Missing required fields', 'Video data or verification ID is required'));
    }

    if (!consent?.given) {
      return res.status(400).json(errorResponse('Consent required', 'User consent is required for liveness detection'));
    }

    logger.info('🔄 Performing Liveness Detection', { userId });

    // Get verification provider
    const provider = getVerificationProvider(process.env);
    
    // Call provider to verify liveness
    const result = await provider.verifyLiveness(videoData || verificationId);

    // Create verification record
    const now = new Date();
    const verification = await Verification.create({
      userId,
      type: 'liveness',
      status: result.success ? 'verified' : 'failed',
      provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
      verifiedData: { 
        isLive: result.success,
        confidence: result.data?.confidence,
        status: result.success ? 'REAL_FACE_DETECTED' : 'REAL_FACE_NOT_DETECTED'
      },
      consent: {
        given: true,
        givenAt: now,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        consentVersion: consent.version || 'v1.0',
        consentText: consent.text || 'User consented to liveness detection'
      },
      auditLog: [{
        action: 'liveness_verified',
        performedBy: userId,
        performedAt: now,
        ipAddress: getClientIp(req),
        metadata: {
          provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
          environment: process.env.CASHFREE_ENV || 'sandbox'
        }
      }],
      verifiedAt: result.success ? now : null,
      failedAt: result.success ? null : now,
      failureReason: result.success ? null : result.message,
      metadata: {
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        environment: process.env.CASHFREE_ENV || 'sandbox'
      }
    });

    logger.info('✅ Liveness detection completed', { 
      userId, 
      verificationId: verification._id,
      status: verification.status,
      isLive: result.success
    });

    res.json(successResponse({
      verificationId: verification._id,
      isLive: result.success,
      confidence: result.data?.confidence,
      status: verification.status
    }, 'Liveness detection completed'));

  } catch (error) {
    logger.error('❌ Liveness detection error', { 
      userId: req.headers['x-user-id'],
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json(errorResponse(
      error.message || 'Failed to perform liveness detection',
      'An error occurred while performing liveness detection'
    ));
  }
});

// =====================================================
// BULK STORAGE ENDPOINT (for admin bulk upload)
// =====================================================

/**
 * POST /api/v1/verification/bulk-store
 * Store masked verification data directly (bypasses OTP flow)
 * Used for bulk upload of pre-verified users
 * 
 * ✅ ENHANCED: Now checks for existing verification and updates with history tracking
 */
router.post('/bulk-store', serviceAuthMiddleware, async (req, res) => {
  try {
    const { 
      userId, 
      type, 
      maskedValue, 
      status, 
      verifiedAt, 
      provider, 
      consent,
      verificationSource,  // NEW: Track source (admin_manual, admin_bulk, etc.)
      verifiedBy          // NEW: Admin info { userId, userName, role }
    } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    if (!type || !['aadhaar', 'pan'].includes(type)) {
      return res.status(400).json(errorResponse(
        'Invalid verification type',
        'Type must be "aadhaar" or "pan"'
      ));
    }

    if (!maskedValue) {
      return res.status(400).json(errorResponse(
        'Missing required field: maskedValue',
        'Masked value is required'
      ));
    }

    logger.info('📦 [BULK STORE] Processing verification data', {
      userId,
      type,
      maskedValue,
      provider: provider || 'admin_manual',
      verificationSource: verificationSource || 'admin_manual',
      verifiedBy: verifiedBy?.userId || 'system'
    });

    // ✅ Check if verification already exists
    let verification = await Verification.findOne({ userId, type });
    let isUpdate = false;

    if (verification) {
      // ===== VERIFICATION EXISTS - UPDATE WITH HISTORY =====
      isUpdate = true;
      
      logger.info('📝 [BULK STORE] Found existing verification, updating with history', {
        userId,
        type,
        existingVerificationId: verification._id,
        previousSource: verification.verificationSource,
        newSource: verificationSource || 'admin_manual'
      });

      // Get previous masked value
      const previousMaskedValue = type === 'aadhaar' 
        ? verification.maskedAadhaar 
        : verification.maskedPAN;

      // Store previous values in history
      const historyEntry = {
        previousMaskedValue: previousMaskedValue,
        newMaskedValue: maskedValue,
        previousProvider: verification.provider,
        newProvider: provider || 'admin_manual',
        previousSource: verification.verificationSource || 'self_service_api',
        newSource: verificationSource || 'admin_manual',
        updatedAt: new Date(),
        updatedBy: verifiedBy?.userId || 'system',
        reason: `Updated by ${verificationSource || 'admin_manual'} - previous verification was ${verification.verificationSource || 'self_service_api'}`,
        metadata: {
          previousStatus: verification.status,
          previousVerifiedAt: verification.verifiedAt,
          updatedByName: verifiedBy?.userName,
          updatedByRole: verifiedBy?.role
        }
      };

      // Add to history (initialize if doesn't exist)
      if (!verification.updateHistory) {
        verification.updateHistory = [];
      }
      verification.updateHistory.push(historyEntry);

      // Update current values
      verification.status = status || 'verified';
      verification.provider = provider || 'admin_manual';
      verification.verificationSource = verificationSource || 'admin_manual';
      verification.verifiedAt = verifiedAt ? new Date(verifiedAt) : new Date();
      verification.verifiedBy = verifiedBy;
      
      // Update masked value based on type
      if (type === 'aadhaar') {
        verification.maskedAadhaar = maskedValue;
      } else if (type === 'pan') {
        verification.maskedPAN = maskedValue;
      }

      // Add audit log entry
      verification.auditLog.push({
        action: 'updated_by_admin',
        performedBy: verifiedBy?.userId || 'system',
        performedAt: new Date(),
        metadata: { 
          source: 'bulk_store',
          previousSource: historyEntry.previousSource,
          newSource: historyEntry.newSource,
          reason: 'Admin updated verification',
          verifiedByName: verifiedBy?.userName,
          verifiedByRole: verifiedBy?.role
        }
      });

      await verification.save();

      logger.info('✅ [BULK STORE] Updated existing verification with history', {
        userId,
        type,
        verificationId: verification._id,
        previousSource: historyEntry.previousSource,
        newSource: historyEntry.newSource,
        historyCount: verification.updateHistory.length
      });

    } else {
      // ===== NO EXISTING VERIFICATION - CREATE NEW =====
      
      logger.info('📝 [BULK STORE] Creating new verification record', {
        userId,
        type,
        verificationSource: verificationSource || 'admin_manual'
      });

      // Create verification record
      const verificationData = {
        userId,
        type,
        status: status || 'verified',
        provider: provider || 'admin_manual',
        verificationSource: verificationSource || 'admin_manual',
        verifiedBy: verifiedBy,
        verifiedAt: verifiedAt ? new Date(verifiedAt) : new Date(),
        consent: consent || {
          given: true,
          givenAt: new Date(),
          consentVersion: 'v1.0',
          consentText: `Document verified by ${verificationSource || 'admin'} - ${type} verification`
        },
        auditLog: [{
          action: 'verified',
          performedBy: verifiedBy?.userId || 'system',
          performedAt: new Date(),
          metadata: { 
            source: 'bulk_store',
            verificationSource: verificationSource || 'admin_manual',
            verifiedByName: verifiedBy?.userName,
            verifiedByRole: verifiedBy?.role
          }
        }],
        updateHistory: [] // Initialize empty history array
      };

      // Set masked value based on type
      if (type === 'aadhaar') {
        verificationData.maskedAadhaar = maskedValue;
      } else if (type === 'pan') {
        verificationData.maskedPAN = maskedValue;
      }

      verification = new Verification(verificationData);
      await verification.save();

      logger.info('✅ [BULK STORE] Created new verification', {
        userId,
        type,
        verificationId: verification._id,
        source: verification.verificationSource
      });
    }

    // Update user profile in user-service
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:4002';
      const updateField = type === 'aadhaar' ? 'isAadhaarVerified' : 'isPANVerified';
      const updateData = {
        [updateField]: true,
        [`${type}VerifiedAt`]: new Date().toISOString()
      };

      await axios.patch(
        `${userServiceUrl}/api/v1/profiles/${userId}/verification/${type}`,
        updateData,
        {
          headers: {
            'X-Service-Auth': process.env.SERVICE_AUTH_TOKEN,
            'X-Service-Name': 'verification-service',
            'X-User-Id': userId,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`✅ [BULK STORE] Updated user profile for ${userId}`, { type, updateField, isUpdate });
    } catch (profileError) {
      logger.error(`⚠️ [BULK STORE] Failed to update user profile for ${userId}`, {
        error: profileError.message,
        type
      });
      // Don't fail the request if profile update fails
    }

    // Build response with update information
    const responseData = {
      verificationId: verification._id,
      userId,
      type,
      maskedValue,
      status: verification.status,
      verifiedAt: verification.verifiedAt,
      source: verification.verificationSource,
      isUpdate: isUpdate
    };

    // Add previous info if this was an update
    if (isUpdate && verification.updateHistory.length > 0) {
      const latestHistory = verification.updateHistory[verification.updateHistory.length - 1];
      responseData.previousSource = latestHistory.previousSource;
      responseData.previousMaskedValue = latestHistory.previousMaskedValue;
      responseData.historyCount = verification.updateHistory.length;
    }

    const message = isUpdate 
      ? `Verification data updated successfully (previous: ${responseData.previousSource})`
      : 'Verification data stored successfully';

    res.json(successResponse(responseData, message));

  } catch (error) {
    // Handle duplicate key error (shouldn't happen with findOne + update, but just in case)
    if (error.code === 11000) {
      logger.error('❌ [BULK STORE] Duplicate verification detected', {
        userId: req.body.userId,
        type: req.body.type,
        error: error.message
      });
      return res.status(409).json(errorResponse(
        'Verification already exists for this user and type',
        'A verification record already exists. This should not happen - please contact support.'
      ));
    }

    logger.error('❌ [BULK STORE] Error storing verification data', {
      error: error.message,
      stack: error.stack,
      userId: req.body.userId,
      type: req.body.type
    });
    res.status(500).json(errorResponse(
      'Failed to store verification data',
      error.message
    ));
  }
});

module.exports = router;

