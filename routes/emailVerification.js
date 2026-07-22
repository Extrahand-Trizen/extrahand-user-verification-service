/**
 * Email Verification Routes
 * 
 * Endpoints for email verification flow:
 * - POST /email/initiate - Send verification OTP to email
 * - POST /email/verify - Verify OTP and mark email as verified
 * - POST /email/resend - Resend verification OTP
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Verification = require('../models/Verification');
const { serviceAuthMiddleware } = require('../middleware/auth');
const { successResponse, errorResponse, getClientIp } = require('../utils/helpers');
const logger = require('../config/logger');
const { EmailServiceClient } = require('../services/emailServiceClient');
const userService = require('../services/userService');

// OTP Configuration
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Generate a random OTP
 */
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Mask email for display (e.g., j***@example.com)
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 2) return `${localPart[0]}***@${domain}`;
  return `${localPart[0]}${localPart[1]}***@${domain}`;
}

// =====================================================
// EMAIL VERIFICATION ROUTES
// =====================================================

/**
 * POST /api/v1/verification/email/initiate
 * Initiate email verification - Send OTP to email
 */
router.post('/email/initiate', serviceAuthMiddleware, async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { email, consentGiven } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    if (!email) {
      return res.status(400).json(errorResponse(
        'Missing required field: email',
        'Email address is required'
      ));
    }

    if (!isValidEmail(email)) {
      return res.status(400).json(errorResponse(
        'Invalid email format',
        'Please provide a valid email address'
      ));
    }

    if (!consentGiven) {
      return res.status(400).json(errorResponse(
        'User consent required',
        'User consent is required for email verification'
      ));
    }

    logger.info('🔄 Initiating email verification', {
      userId,
      maskedEmail: maskEmail(email),
      ip: getClientIp(req)
    });

    // Check if already verified
    let verification = await Verification.findOne({
      userId,
      type: 'email',
      status: 'verified'
    });

    if (verification && verification.verifiedData?.email === email) {
      logger.info('✅ Email already verified for user', { userId });
      return res.status(200).json({
        success: true,
        message: 'Email is already verified',
        data: {
          alreadyVerified: true,
          status: 'verified',
          maskedEmail: maskEmail(email),
          verifiedAt: verification.verifiedAt
        },
        timestamp: new Date().toISOString()
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Create or update verification record
    const verificationData = {
      userId,
      type: 'email',
      status: 'otp_sent',
      provider: 'internal',
      maskedEmail: maskEmail(email),
      otpSent: true,
      otpSentAt: now,
      otpExpiresAt: otpExpiresAt,
      otpHash: crypto.createHash('sha256').update(otp).digest('hex'),
      otpAttempts: 0,
      consent: {
        given: true,
        givenAt: now,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        consentVersion: 'v1.0',
        consentText: 'User agreed to email verification'
      },
      auditLog: [{
        action: 'initiated',
        performedBy: userId,
        performedAt: now,
        ipAddress: getClientIp(req),
        metadata: { email: maskEmail(email) }
      }],
      initiatedAt: now,
      metadata: {
        email: email, // Store actual email in metadata
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown'
      }
    };

    // Find existing or create new
    verification = await Verification.findOne({ userId, type: 'email' });
    if (verification) {
      // Explicitly update all fields (Object.assign may not work well with Mongoose nested objects)
      verification.status = 'otp_sent';
      verification.provider = 'internal';
      verification.maskedEmail = maskEmail(email);
      verification.otpSent = true;
      verification.otpSentAt = now;
      verification.otpExpiresAt = otpExpiresAt;
      verification.otpHash = crypto.createHash('sha256').update(otp).digest('hex');
      verification.otpAttempts = 0;
      verification.consent = verificationData.consent;
      verification.auditLog = verification.auditLog || [];
      verification.auditLog.push(verificationData.auditLog[0]);
      verification.initiatedAt = now;
      // Explicitly set metadata with email
      verification.metadata = {
        email: email, // Store actual email in metadata
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown'
      };
      verification.markModified('metadata'); // Tell Mongoose to save this field
      await verification.save();
      
      logger.info('📧 Updated existing verification record with email', {
        userId,
        verificationId: verification._id,
        hasEmailInMetadata: !!verification.metadata?.email
      });
    } else {
      verification = await Verification.create(verificationData);
      
      logger.info('📧 Created new verification record with email', {
        userId,
        verificationId: verification._id,
        hasEmailInMetadata: !!verification.metadata?.email
      });
    }

    // Send verification email with OTP
    try {
      await EmailServiceClient.sendEmailVerification(
        email,
        otp,
        null, // No verification link, using OTP
        null, // Name will be fetched from context
        otpExpiresAt
      );
      logger.info('✅ Verification email sent', { userId, maskedEmail: maskEmail(email) });
    } catch (emailError) {
      logger.error('❌ Failed to send verification email', {
        userId,
        error: emailError.message
      });
      return res.status(500).json(errorResponse(
        'Failed to send verification email',
        'Please try again later'
      ));
    }

    logger.info('✅ Email verification initiated', {
      userId,
      verificationId: verification._id,
      status: 'otp_sent'
    });

    res.json(successResponse({
      verificationId: verification._id,
      maskedEmail: maskEmail(email),
      expiresAt: otpExpiresAt.toISOString(),
      expiresInMinutes: OTP_EXPIRY_MINUTES
    }, 'Verification code sent to your email'));

  } catch (error) {
    logger.error('❌ Error initiating email verification', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to initiate email verification',
      'An error occurred while initiating verification'
    ));
  }
});

/**
 * POST /api/v1/verification/email/verify
 * Verify email OTP
 */
router.post('/email/verify', serviceAuthMiddleware, async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { otp, verificationId } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    if (!otp) {
      return res.status(400).json(errorResponse(
        'Missing required field: otp',
        'Verification code is required'
      ));
    }

    if (otp.length !== OTP_LENGTH || !/^\d+$/.test(otp)) {
      return res.status(400).json(errorResponse(
        'Invalid OTP format',
        `Verification code must be ${OTP_LENGTH} digits`
      ));
    }

    logger.info('🔄 Verifying email OTP', {
      userId,
      hasVerificationId: !!verificationId,
      ip: getClientIp(req)
    });

    // Find verification record
    const query = verificationId 
      ? { _id: verificationId, userId, type: 'email' }
      : { userId, type: 'email', status: 'otp_sent' };
    
    const verification = await Verification.findOne(query);
    
    // Debug: log the verification record
    logger.info('🔍 Found verification record', {
      userId,
      verificationId: verification?._id,
      hasMetadata: !!verification?.metadata,
      metadataKeys: verification?.metadata ? Object.keys(verification.metadata) : [],
      metadataEmail: verification?.metadata?.email,
      status: verification?.status
    });

    if (!verification) {
      return res.status(404).json(errorResponse(
        'Verification session not found',
        'Please initiate email verification first'
      ));
    }

    if (verification.status === 'verified') {
      return res.status(200).json({
        success: true,
        message: 'Email is already verified',
        data: {
          alreadyVerified: true,
          status: 'verified',
          maskedEmail: verification.maskedEmail,
          verifiedAt: verification.verifiedAt
        }
      });
    }

    // Check OTP expiry
    if (new Date() > verification.otpExpiresAt) {
      return res.status(400).json(errorResponse(
        'OTP has expired',
        'Please request a new verification code',
        'OTP_EXPIRED'
      ));
    }

    // Check attempts
    if (verification.otpAttempts >= MAX_OTP_ATTEMPTS) {
      verification.status = 'failed';
      verification.failedAt = new Date();
      verification.failureReason = 'Maximum OTP attempts exceeded';
      await verification.save();

      return res.status(400).json(errorResponse(
        'Maximum attempts exceeded',
        'Please request a new verification code'
      ));
    }

    // Verify OTP
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    
    if (otpHash !== verification.otpHash) {
      verification.otpAttempts = (verification.otpAttempts || 0) + 1;
      await verification.save();

      const attemptsRemaining = MAX_OTP_ATTEMPTS - verification.otpAttempts;
      return res.status(400).json(errorResponse(
        'Invalid verification code',
        `${attemptsRemaining} attempts remaining`
      ));
    }

    // OTP is valid - mark as verified
    verification.status = 'verified';
    verification.otpVerified = true;
    verification.otpVerifiedAt = new Date();
    verification.verifiedAt = new Date();
    verification.verifiedData = {
      email: verification.metadata?.email,
      maskedEmail: verification.maskedEmail
    };
    verification.otpAttempts = 0;
    verification.auditLog.push({
      action: 'verified',
      performedBy: userId,
      performedAt: new Date(),
      ipAddress: getClientIp(req)
    });
    await verification.save();

    // Update user profile with verified email
    logger.info('🔄 Attempting to update user profile with verified email', { 
      userId, 
      hasEmail: !!verification.metadata?.email,
      email: verification.metadata?.email 
    });
    
    try {
      const email = verification.metadata?.email;
      if (email) {
        logger.info('📞 Calling userService.updateEmailVerificationStatus...', { userId, email });
        const updateResult = await userService.updateEmailVerificationStatus(userId, {
          email: email,
          isEmailVerified: true,
          emailVerifiedAt: new Date().toISOString()
        });
        logger.info('✅ User profile update result', { userId, updateResult });
      } else {
        logger.warn('⚠️ No email found in verification.metadata, skipping profile update', { userId });
      }
    } catch (updateError) {
      logger.warn('⚠️ Failed to update user profile (non-blocking)', {
        userId,
        error: updateError.message,
        stack: updateError.stack
      });
    }

    logger.info('✅ Email verification successful', {
      userId,
      verificationId: verification._id
    });

    res.json(successResponse({
      status: 'verified',
      maskedEmail: verification.maskedEmail,
      verifiedAt: verification.verifiedAt
    }, 'Email verified successfully'));

  } catch (error) {
    logger.error('❌ Error verifying email OTP', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to verify email',
      'An error occurred while verifying email'
    ));
  }
});

/**
 * POST /api/v1/verification/email/resend
 * Resend verification OTP
 */
router.post('/email/resend', serviceAuthMiddleware, async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;

    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    logger.info('🔄 Resending email verification OTP', {
      userId,
      ip: getClientIp(req)
    });

    // Find existing verification
    const verification = await Verification.findOne({
      userId,
      type: 'email'
    });

    if (!verification) {
      return res.status(404).json(errorResponse(
        'No verification found',
        'Please initiate email verification first'
      ));
    }

    if (verification.status === 'verified') {
      return res.status(400).json(errorResponse(
        'Already verified',
        'This email is already verified'
      ));
    }

    // Check cooldown
    if (verification.otpSentAt) {
      const timeSinceLastOTP = Date.now() - new Date(verification.otpSentAt).getTime();
      if (timeSinceLastOTP < RESEND_COOLDOWN_SECONDS * 1000) {
        const remainingSeconds = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - timeSinceLastOTP) / 1000);
        return res.status(429).json(errorResponse(
          'Please wait before requesting another code',
          `You can request a new code after ${remainingSeconds} seconds`,
          'RESEND_COOLDOWN'
        ));
      }
    }

    // Generate new OTP
    const otp = generateOTP();
    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Update verification
    verification.otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    verification.otpSentAt = now;
    verification.otpExpiresAt = otpExpiresAt;
    verification.otpAttempts = 0;
    verification.status = 'otp_sent';
    verification.auditLog.push({
      action: 'resent',
      performedBy: userId,
      performedAt: now,
      ipAddress: getClientIp(req)
    });
    await verification.save();

    // Send verification email
    const email = verification.metadata?.email;
    if (email) {
      try {
        await EmailServiceClient.sendEmailVerification(
          email,
          otp,
          null,
          null,
          otpExpiresAt
        );
        logger.info('✅ Verification email resent', { userId, maskedEmail: verification.maskedEmail });
      } catch (emailError) {
        logger.error('❌ Failed to resend verification email', {
          userId,
          error: emailError.message
        });
        return res.status(500).json(errorResponse(
          'Failed to send verification email',
          'Please try again later'
        ));
      }
    }

    logger.info('✅ Email verification OTP resent', {
      userId,
      verificationId: verification._id
    });

    res.json(successResponse({
      verificationId: verification._id,
      maskedEmail: verification.maskedEmail,
      expiresAt: otpExpiresAt.toISOString(),
      expiresInMinutes: OTP_EXPIRY_MINUTES
    }, 'Verification code resent successfully'));

  } catch (error) {
    logger.error('❌ Error resending verification OTP', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to resend verification code',
      'An error occurred while resending code'
    ));
  }
});

/**
 * GET /api/v1/verification/email/status/:userId
 * Get email verification status
 */
router.get('/email/status/:userId', serviceAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const verification = await Verification.findOne({
      userId,
      type: 'email'
    });

    if (!verification) {
      return res.json(successResponse({
        status: 'not_initiated',
        isVerified: false
      }, 'Email verification not initiated'));
    }

    res.json(successResponse({
      status: verification.status,
      isVerified: verification.status === 'verified',
      maskedEmail: verification.maskedEmail,
      verifiedAt: verification.verifiedAt,
      attemptsRemaining: Math.max(0, MAX_OTP_ATTEMPTS - (verification.otpAttempts || 0))
    }));

  } catch (error) {
    logger.error('❌ Error fetching email verification status', {
      error: error.message,
      userId: req.params.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to fetch verification status',
      'An error occurred'
    ));
  }
});

module.exports = router;
