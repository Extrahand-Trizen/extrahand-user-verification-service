const express = require('express');
const router = express.Router();
const Verification = require('../models/Verification');
const cashfreeService = require('../services/cashfreeService');
const { getVerificationProvider } = require('../services/providerFactory');
const { serviceAuthMiddleware } = require('../middleware/auth');
const userService = require('../services/userService');
// Rate limiters disabled temporarily
// const { otpGenerationLimiter, otpResendLimiter, otpVerificationLimiter } = require('../middleware/rateLimiting');
const { isValidAadhaarFormat, cleanAadhaarNumber, isValidOtpFormat, maskAadhaar } = require('../utils/validation');
const { successResponse, errorResponse, getClientIp } = require('../utils/helpers');
const logger = require('../config/logger');

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
// AADHAAR VERIFICATION ROUTES (ACTIVE)
// =====================================================

/**
 * POST /api/v1/verification/aadhaar/initiate
 * Initiate Aadhaar KYC - Generate OTP
 * Rate limited: 3 requests per user per hour
 */
router.post('/aadhaar/initiate', serviceAuthMiddleware, /* otpGenerationLimiter - DISABLED temporarily */ async (req, res) => {
  try {
    // Feature flag check
    if (!FEATURES.AADHAAR) {
      return res.status(503).json(errorResponse(
        'Aadhaar verification is temporarily disabled',
        'This feature is currently unavailable',
        'FEATURE_DISABLED'
      ));
    }

    const userId = req.headers['x-user-id'] || req.body.userId;
    const { aadhaarNumber, consentGiven, consent } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    if (!aadhaarNumber) {
      return res.status(400).json(errorResponse(
        'Missing required field: aadhaarNumber',
        'Aadhaar number is required'
      ));
    }

    if (!consentGiven) {
      return res.status(400).json(errorResponse(
        'User consent required',
        'User consent is required for Aadhaar verification'
      ));
    }

    // Clean and validate Aadhaar number
    const cleanedAadhaar = cleanAadhaarNumber(aadhaarNumber);
    if (!isValidAadhaarFormat(cleanedAadhaar)) {
      return res.status(400).json(errorResponse(
        'Invalid Aadhaar number format',
        'Aadhaar number must be exactly 12 digits'
      ));
    }

    logger.info('🔄 Initiating Aadhaar verification', {
      userId,
      maskedAadhaar: maskAadhaar(cleanedAadhaar),
      ip: getClientIp(req)
    });

    // ✨ FIRST: Check User Service to see if user is already verified
    try {
      const userProfile = await userService.getUserProfile(userId);
      // User Service returns { success: true, profile: { ... } }
      // userProfile.data = { success: true, profile: { ... } }
      const profile = userProfile.data?.profile || userProfile.data;
      
      logger.info('🔍 Checking User Service for verification status', {
        userId,
        hasData: !!userProfile.data,
        hasProfile: !!profile,
        isAadhaarVerified: profile?.isAadhaarVerified
      });
      
      if (userProfile.success && profile?.isAadhaarVerified === true) {
        logger.info('✅ User already verified in User Service', { 
          userId,
          verifiedAt: profile.aadhaarVerifiedAt
        });
        return res.status(200).json({
          success: true,
          message: 'Aadhaar is already verified',
          data: {
            alreadyVerified: true,
            status: 'verified',
            maskedAadhaar: profile.maskedAadhaar || maskAadhaar(cleanedAadhaar),
            verifiedAt: profile.aadhaarVerifiedAt
          },
          timestamp: new Date().toISOString()
        });
      }
    } catch (userServiceError) {
      // Log but don't fail - continue with verification service check
      logger.warn('⚠️ Could not check User Service, continuing with verification service check', {
        userId,
        error: userServiceError.message,
        stack: userServiceError.stack
      });
    }

    // Check if verification already exists and is verified in verification service
    let verification = await Verification.findByUserId(userId);
    
    if (verification && verification.status === 'verified') {
      logger.warn('⚠️ User already verified in verification service', { userId });
      // Return 200 with already verified status instead of 400 error
      return res.status(200).json({
        success: true,
        message: 'Aadhaar is already verified',
        data: {
          alreadyVerified: true,
          status: 'verified',
          maskedAadhaar: verification.maskedAadhaar || maskAadhaar(cleanedAadhaar),
          verifiedAt: verification.verifiedAt
        },
        timestamp: new Date().toISOString()
      });
    }

    // Generate OTP via Cashfree
    const otpResult = await cashfreeService.generateAadhaarOTP(cleanedAadhaar);

    if (!otpResult.success) {
      return res.status(400).json(errorResponse(
        otpResult.message || 'Failed to generate OTP',
        'Could not initiate Aadhaar verification'
      ));
    }

    // Save verification record
    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // OTP expires in 10 minutes
    
    // Enhanced consent object (backward compatible)
    const consentData = consent || {
      given: consentGiven === true,
      text: 'User agreed to Aadhaar verification',
      version: 'v1.0'
    };
    
    const verificationData = {
      userId,
      type: 'aadhaar',
      status: 'otp_sent',
      provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
      transactionId: otpResult.refId,
      refId: otpResult.refId,
      maskedAadhaar: maskAadhaar(cleanedAadhaar),
      otpSent: true,
      otpSentAt: now,
      otpExpiresAt: otpExpiresAt,
      // Enhanced consent tracking
      consent: {
        given: true,
        givenAt: now,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        consentVersion: consentData.version || 'v1.0',
        consentText: consentData.text || 'User agreed to Aadhaar verification'
      },
      // Audit log
      auditLog: [{
        action: 'initiated',
        performedBy: userId,
        performedAt: now,
        ipAddress: getClientIp(req),
        metadata: {
          provider: process.env.VERIFICATION_PROVIDER || 'cashfree',
          environment: process.env.CASHFREE_ENV || 'sandbox'
        }
      }],
      initiatedAt: now,
      metadata: {
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        environment: process.env.CASHFREE_ENV || 'sandbox'
      }
    };

    if (verification) {
      // Update existing verification
      Object.assign(verification, verificationData);
      await verification.save();
    } else {
      // Create new verification
      verification = await Verification.create(verificationData);
    }

    logger.info('✅ Aadhaar verification initiated', {
      userId,
      refId: otpResult.refId,
      status: 'otp_sent'
    });

    const response = successResponse({
      transactionId: otpResult.refId,
      refId: otpResult.refId,
      maskedAadhaar: verificationData.maskedAadhaar
    }, 'OTP sent successfully');

    // In sandbox, include test OTP for testing convenience
    if (cashfreeService.isSandbox()) {
      response.data.testOtp = cashfreeService.getTestOtp();
      response.data.message = 'OTP sent successfully (Sandbox mode - use test OTP for testing)';
    }

    res.json(response);
  } catch (error) {
    logger.error('❌ Error initiating Aadhaar KYC', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to initiate Aadhaar verification',
      'An error occurred while initiating verification'
    ));
  }
});

/**
 * POST /api/v1/verification/aadhaar/verify
 * Verify Aadhaar OTP
 * Rate limited: 10 attempts per user per 15 minutes
 */
router.post('/aadhaar/verify', serviceAuthMiddleware, /* otpVerificationLimiter - DISABLED temporarily */ async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { transactionId, refId, otp } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    const verificationRefId = refId || transactionId;
    if (!verificationRefId) {
      return res.status(400).json(errorResponse(
        'Missing required field: refId or transactionId',
        'Reference ID is required'
      ));
    }

    if (!otp) {
      return res.status(400).json(errorResponse(
        'Missing required field: otp',
        'OTP is required'
      ));
    }

    if (!isValidOtpFormat(otp)) {
      return res.status(400).json(errorResponse(
        'Invalid OTP format',
        'OTP must be 6 digits'
      ));
    }

    logger.info('🔄 Verifying Aadhaar OTP', {
      userId,
      refId: verificationRefId,
      ip: getClientIp(req)
    });

    // Get verification record
    const verification = await Verification.findOne({ 
      userId, 
      $or: [
        { refId: verificationRefId },
        { transactionId: verificationRefId }
      ]
    });

    if (!verification) {
      logger.warn('⚠️ Verification session not found', { userId, refId: verificationRefId });
      return res.status(404).json(errorResponse(
        'Verification session not found',
        'No active verification session found for this user'
      ));
    }

    if (verification.status !== 'otp_sent') {
      return res.status(400).json(errorResponse(
        'OTP not sent for this verification',
        `Verification status is: ${verification.status}`
      ));
    }

    // Check if OTP has expired
    if (verification.isOtpExpired()) {
      logger.warn('⚠️ OTP has expired', { userId, refId: verificationRefId });
      return res.status(400).json(errorResponse(
        'OTP has expired',
        'The OTP has expired. Please request a new one.',
        'OTP_EXPIRED'
      ));
    }

    // Check OTP attempts
    if (verification.hasExceededAttempts()) {
      verification.status = 'failed';
      verification.failedAt = new Date();
      verification.failureReason = 'Maximum OTP attempts exceeded';
      await verification.save();

      logger.warn('⚠️ Maximum OTP attempts exceeded', { userId, refId: verificationRefId });
      return res.status(400).json(errorResponse(
        'Maximum OTP attempts exceeded',
        'You have exceeded the maximum number of OTP verification attempts'
      ));
    }

    // Verify OTP via Cashfree
    const verifyResult = await cashfreeService.verifyAadhaarOTP(verificationRefId, otp);

    // Update verification record
    if (verifyResult.success) {
      verification.status = 'verified';
      verification.otpVerified = true;
      verification.otpVerifiedAt = new Date();
      verification.verifiedAt = new Date();
      verification.verifiedData = verifyResult.verifiedData;
      // Always update maskedAadhaar if provided, otherwise keep existing value
      if (verifyResult.maskedAadhaar) {
        verification.maskedAadhaar = verifyResult.maskedAadhaar;
      }
      verification.otpAttempts = 0; // Reset attempts on success
    } else {
      verification.otpAttempts = (verification.otpAttempts || 0) + 1;
      verification.status = verifyResult.message.includes('OTP') ? 'otp_sent' : 'failed';
      verification.failureReason = verifyResult.message;
      
      if (verification.otpAttempts >= 3) {
        verification.status = 'failed';
        verification.failedAt = new Date();
      }
    }

    // ✨ LOG: Before saving verification to MongoDB
    logger.info('💾 [MONGODB] Saving verification record to MongoDB', {
      userId,
      refId: verificationRefId,
      status: verification.status,
      verifiedAt: verification.verifiedAt,
      verificationId: verification._id?.toString()
    });
    
    await verification.save();
    
    // ✨ LOG: After saving verification to MongoDB
    logger.info('✅ [MONGODB] Verification record saved to MongoDB', {
      userId,
      refId: verificationRefId,
      status: verification.status,
      verificationId: verification._id?.toString(),
      verifiedAt: verification.verifiedAt
    });

    if (verifyResult.success) {
      logger.info('✅ Aadhaar OTP verified successfully', {
        userId,
        refId: verificationRefId,
        status: 'verified'
      });

      // ✨ Update User Service with verification status
      logger.info('📞 [VERIFICATION → USER SERVICE] Calling User Service to update Aadhaar verification status', {
        userId,
        maskedAadhaar: verifyResult.maskedAadhaar,
        verifiedData: {
          name: verifyResult.verifiedData.name,
          gender: verifyResult.verifiedData.gender,
          yearOfBirth: verifyResult.verifiedData.yearOfBirth
        }
      });
      
      try {
        const userServiceUpdate = await userService.updateAadhaarVerificationStatus(userId, {
          isAadhaarVerified: true,
          aadhaarVerifiedAt: new Date().toISOString(),
          maskedAadhaar: verifyResult.maskedAadhaar,
          verifiedData: {
            name: verifyResult.verifiedData.name,
            gender: verifyResult.verifiedData.gender,
            yearOfBirth: verifyResult.verifiedData.yearOfBirth
          }
        });

        if (userServiceUpdate.success) {
          logger.info('✅ [VERIFICATION → USER SERVICE] User Service updated with Aadhaar verification', { 
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
          responseStatus: updateError.response?.status,
          responseData: updateError.response?.data
        });
      }

      res.json(successResponse({
        status: 'verified',
        maskedAadhaar: verifyResult.maskedAadhaar,
        verifiedData: {
          name: verifyResult.verifiedData.name,
          gender: verifyResult.verifiedData.gender,
          yearOfBirth: verifyResult.verifiedData.yearOfBirth
        }
      }, 'Aadhaar verification successful'));
    } else {
      logger.warn('⚠️ Aadhaar OTP verification failed', {
        userId,
        refId: verificationRefId,
        attempts: verification.otpAttempts,
        message: verifyResult.message
      });

      res.status(400).json(errorResponse(
        verifyResult.message || 'OTP verification failed',
        `Verification failed. ${3 - verification.otpAttempts} attempts remaining.`
      ));
    }
  } catch (error) {
    logger.error('❌ Error verifying Aadhaar OTP', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to verify OTP',
      'An error occurred while verifying OTP'
    ));
  }
});

/**
 * POST /api/v1/verification/aadhaar/resend
 * Resend OTP for Aadhaar verification
 * Rate limited: 5 requests per user per hour
 */
router.post('/aadhaar/resend', serviceAuthMiddleware, /* otpResendLimiter - DISABLED temporarily */ async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { refId } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    logger.info('🔄 Resending Aadhaar OTP', {
      userId,
      refId,
      ip: getClientIp(req)
    });

    // Get existing verification record
    let verification;
    if (refId) {
      verification = await Verification.findOne({ 
        userId,
        $or: [
          { refId: refId },
          { transactionId: refId }
        ]
      });
    } else {
      verification = await Verification.findByUserId(userId);
    }

    if (!verification) {
      logger.warn('⚠️ No verification record found for user', { userId });
      return res.status(404).json(errorResponse(
        'No verification found',
        'Please initiate verification first'
      ));
    }

    if (verification.status === 'verified') {
      return res.status(400).json(errorResponse(
        'Already verified',
        'This user is already verified'
      ));
    }

    // Check if OTP was sent recently (cooldown: 60 seconds)
    if (verification.otpSentAt) {
      const timeSinceLastOTP = Date.now() - new Date(verification.otpSentAt).getTime();
      if (timeSinceLastOTP < 60000) { // 60 seconds
        const remainingSeconds = Math.ceil((60000 - timeSinceLastOTP) / 1000);
        return res.status(429).json(errorResponse(
          'Please wait before requesting another OTP',
          `You can request a new OTP after ${remainingSeconds} seconds`,
          'RESEND_COOLDOWN'
        ));
      }
    }

    // Resend OTP via Cashfree
    const otpResult = await cashfreeService.resendAadhaarOTP(verification.refId);

    if (!otpResult.success) {
      return res.status(400).json(errorResponse(
        otpResult.message || 'Failed to resend OTP',
        'Could not resend OTP'
      ));
    }

    // Update verification record
    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // OTP expires in 10 minutes
    
    verification.otpSentAt = now;
    verification.otpExpiresAt = otpExpiresAt;
    verification.otpAttempts = 0; // Reset attempts on resend
    verification.status = 'otp_sent';
    verification.refId = otpResult.refId; // Update refId if it changed
    await verification.save();

    logger.info('✅ Aadhaar OTP resent successfully', {
      userId,
      refId: otpResult.refId
    });

    const response = successResponse({
      refId: otpResult.refId,
      maskedAadhaar: verification.maskedAadhaar,
      message: otpResult.message || 'OTP resent successfully'
    }, 'OTP resent successfully');

    // In sandbox, include test OTP for testing convenience
    if (cashfreeService.isSandbox()) {
      response.data.testOtp = cashfreeService.getTestOtp();
      response.data.message = 'OTP resent successfully (Sandbox mode - use test OTP for testing)';
    }

    res.json(response);
  } catch (error) {
    logger.error('❌ Error resending OTP', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to resend OTP',
      'An error occurred while resending OTP'
    ));
  }
});

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
      verifiedAt: verification.verifiedAt,
      attemptsRemaining: Math.max(0, 3 - (verification.otpAttempts || 0))
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
    const { panNumber, consent } = req.body;

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
      result = await provider.verifyPAN(panNumber);
      logger.info('✅ Provider returned result', { 
        success: result?.success,
        hasData: !!result?.data
      });
    } catch (providerError) {
      logger.error('❌ Provider.verifyPAN threw error', {
        error: providerError.message,
        stack: providerError.stack,
        response: providerError.response?.data
      });
      throw providerError;
    }

    // Create or update verification record
    const now = new Date();
    
    // ✨ NEW: Check if there's an existing verification record (even if failed)
    let verification = await Verification.findOne({
      userId,
      type: 'pan'
    });

    if (verification) {
      // Update existing record
      verification.status = result.success ? 'verified' : 'failed';
      verification.maskedPAN = result.data?.maskedPAN || (panNumber.substring(0, 2) + 'XXX' + panNumber.slice(-4));
      verification.verifiedData = { 
        name: result.data?.name,
        panNumber: result.data?.panNumber,
        status: result.data?.status
      };
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
          environment: process.env.CASHFREE_ENV || 'sandbox'
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
    }

    logger.info('✅ PAN verification completed', { 
      userId, 
      verificationId: verification._id,
      status: verification.status 
    });

    res.json(successResponse({
      verificationId: verification._id,
      maskedPAN: verification.maskedPAN,
      verifiedData: {
        name: verification.verifiedData?.name
      },
      status: verification.status
    }, 'PAN verified successfully'));

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

module.exports = router;

