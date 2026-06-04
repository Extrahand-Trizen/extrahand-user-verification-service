/**
 * Aadhaar Smart OCR routes — additive; does not modify DigiLocker routes.
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { serviceAuthMiddleware } = require('../middleware/auth');
const { ocrRateLimitMiddleware } = require('../middleware/ocrRateLimit');
const ocrSessionService = require('../services/ocrSessionService');
const { successResponse, errorResponse } = require('../utils/helpers');
const logger = require('../config/logger');
const { redactForLog } = require('../utils/loggerRedaction');

const FEATURE_OCR = process.env.FEATURE_AADHAAR_OCR === 'true';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

function requireOcrFeature(_req, res, next) {
  if (!FEATURE_OCR) {
    return res.status(503).json(
      errorResponse('Aadhaar OCR is not enabled', 'This feature is currently unavailable', 'FEATURE_DISABLED')
    );
  }
  return next();
}

function getUserId(req) {
  return req.headers['x-user-id'] || req.serviceUserId;
}

router.use(requireOcrFeature);
router.use(serviceAuthMiddleware);
router.use(ocrRateLimitMiddleware);

/**
 * POST /aadhaar/ocr/initiate
 */
router.post('/aadhaar/ocr/initiate', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json(errorResponse('Missing userId', 'User ID is required'));
    }

    const result = await ocrSessionService.initiateSession(userId, {
      consentGiven: req.body.consentGiven ?? req.body.consent_given,
    });

    if (result.alreadyVerified) {
      return res.status(200).json(
        successResponse(
          {
            alreadyVerified: true,
            visibleStatus: 'verified',
            maskedAadhaar: result.maskedAadhaar,
            verifiedAt: result.verifiedAt,
          },
          'Aadhaar is already verified'
        )
      );
    }

    return res.json(
      successResponse(
        {
          verification_id: result.verification_id || result.session?.verification_id,
          visibleStatus: result.visibleStatus,
          resumed: result.resumed,
          requiresFront: result.requiresFront,
          requiresBack: result.requiresBack,
        },
        result.resumed ? 'OCR session resumed' : 'OCR session initiated'
      )
    );
  } catch (error) {
    logger.error('OCR initiate error', redactForLog({ error: error.message, code: error.code }));
    const status = error.statusCode || 500;
    return res.status(status).json(
      errorResponse(error.message, 'Could not start OCR verification', error.code)
    );
  }
});

/**
 * POST /aadhaar/ocr/front
 */
router.post('/aadhaar/ocr/front', upload.single('file'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const verificationId = req.body.verification_id || req.body.verificationId;
    if (!userId || !verificationId) {
      return res.status(400).json(errorResponse('Missing fields', 'userId and verification_id are required'));
    }
    if (!req.file) {
      return res.status(400).json(errorResponse('Missing file', 'Image file is required'));
    }

    const data = await ocrSessionService.uploadSide(userId, verificationId, 'front', {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const message = data.softFailure
      ? 'Document is under review'
      : 'Front image processed';
    return res.json(successResponse(data, message));
  } catch (error) {
    logger.error('OCR front upload error', redactForLog({ error: error.message, code: error.code }));
    const status = error.statusCode || 500;
    return res.status(status).json(
      errorResponse(error.message, 'Front image processing failed', error.code)
    );
  }
});

/**
 * POST /aadhaar/ocr/back
 */
router.post('/aadhaar/ocr/back', upload.single('file'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const verificationId = req.body.verification_id || req.body.verificationId;
    if (!userId || !verificationId) {
      return res.status(400).json(errorResponse('Missing fields', 'userId and verification_id are required'));
    }
    if (!req.file) {
      return res.status(400).json(errorResponse('Missing file', 'Image file is required'));
    }

    const data = await ocrSessionService.uploadSide(userId, verificationId, 'back', {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const message = data.softFailure
      ? 'Document is under review'
      : data.visibleStatus === 'verified'
        ? 'Aadhaar verification complete'
        : 'Back image processed — under review';
    return res.json(successResponse(data, message));
  } catch (error) {
    logger.error('OCR back upload error', redactForLog({ error: error.message, code: error.code }));
    const status = error.statusCode || 500;
    return res.status(status).json(
      errorResponse(error.message, 'Back image processing failed', error.code)
    );
  }
});

/**
 * GET /aadhaar/ocr/status?verification_id=
 */
router.get('/aadhaar/ocr/status', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json(errorResponse('Missing userId', 'User ID is required'));
    }

    const data = await ocrSessionService.getStatus(
      userId,
      req.query.verification_id || req.query.verificationId
    );

    return res.json(successResponse(data, 'OCR status'));
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json(
      errorResponse(error.message, 'Could not fetch OCR status', error.code)
    );
  }
});

/**
 * POST /aadhaar/ocr/report-upload-failure
 * Client sync — user-side network failure (stored locally until connectivity returns).
 */
router.post('/aadhaar/ocr/report-upload-failure', async (req, res) => {
  try {
    const userId = getUserId(req);
    const verificationId = req.body.verification_id || req.body.verificationId;
    if (!userId || !verificationId) {
      return res.status(400).json(errorResponse('Missing fields', 'userId and verification_id are required'));
    }

    const data = await ocrSessionService.reportUserNetworkIssue(userId, verificationId);
    return res.json(successResponse(data, 'Upload network failure recorded'));
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json(
      errorResponse(error.message, 'Could not record upload network failure', error.code)
    );
  }
});

/**
 * POST /aadhaar/ocr/cancel
 */
router.post('/aadhaar/ocr/cancel', async (req, res) => {
  try {
    const userId = getUserId(req);
    const verificationId = req.body.verification_id || req.body.verificationId;
    if (!userId || !verificationId) {
      return res.status(400).json(errorResponse('Missing fields', 'userId and verification_id are required'));
    }

    const data = await ocrSessionService.cancelSession(userId, verificationId);
    return res.json(successResponse(data, 'OCR session cancelled'));
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json(
      errorResponse(error.message, 'Could not cancel OCR session', error.code)
    );
  }
});

module.exports = router;
