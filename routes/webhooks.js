const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const KycSession = require('../models/KycSession');
const { finalizeDigilockerSession } = require('../services/digilockerCompletionService');
const logger = require('../config/logger');

/**
 * POST /api/v1/webhooks/cashfree/digilocker
 * Cashfree DigiLocker webhook handler
 * Requires raw body for signature verification - mount with express.raw() in app.js
 */
router.post('/digilocker', async (req, res) => {
  try {
    const rawBody = req.body; // Buffer (from express.raw())
    const timestamp = req.headers['x-webhook-timestamp'];
    const signature = req.headers['x-webhook-signature'];

    if (!rawBody || !timestamp || !signature) {
      logger.warn('⚠️ Webhook missing required headers or body', {
        hasBody: !!rawBody,
        hasTimestamp: !!timestamp,
        hasSignature: !!signature
      });
      return res.status(400).send('Missing required webhook headers');
    }

    // Verify signature: HMAC-SHA256(timestamp + rawBody, clientSecret)
    const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const payload = timestamp + rawBodyStr;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.CASHFREE_CLIENT_SECRET)
      .update(payload)
      .digest('base64');

    if (signature !== expectedSignature) {
      logger.warn('⚠️ Webhook signature mismatch');
      return res.status(401).send('Invalid signature');
    }

    // Parse body for processing
    const data = JSON.parse(rawBodyStr);
    const { event_type, event_time, data: eventData } = data;

    const verificationId = eventData?.verification_id;
    if (!verificationId) {
      logger.warn('⚠️ Webhook missing verification_id', { event_type });
      return res.status(200).send('OK');
    }

    const session = await KycSession.findByVerificationId(verificationId);
    if (!session) {
      logger.info('Webhook received for unknown session', { verificationId, event_type });
      return res.status(200).send('OK');
    }

    // Idempotency: check if we've already processed this event
    const idempotencyKey = `${verificationId}:${event_type}:${event_time}`;
    if (session.lastWebhookEvent === idempotencyKey) {
      logger.info('Webhook already processed (idempotent)', { verificationId, event_type });
      return res.status(200).send('OK');
    }

    // Update session with webhook data
    session.lastWebhookEvent = idempotencyKey;
    session.lastWebhookEventTime = new Date(event_time || Date.now());

    switch (event_type) {
      case 'DIGILOCKER_VERIFICATION_SUCCESS':
        session.status = 'in_progress';
        session.documentConsent = eventData.document_consent || session.documentConsent;
        session.documentConsentValidity = eventData.document_consent_validity
          ? new Date(eventData.document_consent_validity)
          : session.documentConsentValidity;
        session.userDetails = eventData.user_details || session.userDetails || {};
        break;
      case 'DIGILOCKER_VERIFICATION_LINK_EXPIRED':
        session.status = 'expired';
        break;
      case 'DIGILOCKER_VERIFICATION_CONSENT_DENIED':
        session.status = 'consent_denied';
        break;
      case 'DIGILOCKER_VERIFICATION_CONSENT_EXPIRED':
        session.status = 'expired';
        break;
      case 'DIGILOCKER_VERIFICATION_FAILURE':
        session.status = 'failed';
        session.failureReason = eventData?.message || 'Verification failed';
        break;
      default:
        logger.info('Unknown webhook event type', { event_type, verificationId });
    }

    await session.save();

    // Primary resilience path: complete verification on webhook itself,
    // so mobile redirect/callback timing does not affect final status.
    if (event_type === 'DIGILOCKER_VERIFICATION_SUCCESS') {
      try {
        const result = await finalizeDigilockerSession({
          verificationId,
          userId: session.userId,
          completionSource: 'webhook',
        });
        if (!result.success && !result.alreadyCompleted) {
          logger.warn('Webhook auto-completion deferred', {
            verificationId,
            userId: session.userId,
            error: result.error,
          });
        }
      } catch (completeError) {
        logger.error('Webhook auto-completion failed (will rely on app callback fallback)', {
          verificationId,
          userId: session.userId,
          error: completeError?.message || completeError,
        });
      }
    }

    logger.info('✅ Webhook processed', {
      verificationId,
      event_type,
      sessionStatus: session.status
    });

    res.status(200).send('OK');
  } catch (error) {
    logger.error('❌ Webhook handler error', {
      error: error.message,
      stack: error.stack
    });
    // Return 200 to prevent Cashfree from retrying (we've logged the error)
    res.status(200).send('OK');
  }
});

module.exports = router;
