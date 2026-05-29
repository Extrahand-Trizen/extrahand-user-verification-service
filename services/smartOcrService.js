/**
 * Cashfree Smart OCR provider client (POST /bharat-ocr).
 */

const axios = require('axios');
const FormData = require('form-data');
const logger = require('../config/logger');
const { getCashfreeBaseUrl } = require('../config/env');
const { mapOcrResponse } = require('./smartOcrMapper');
const {
  sanitizeCashfreeResponse,
  formatCashfreeResponseForLog,
  logCashfreeResponseToTerminal,
} = require('../utils/sanitizeCashfreeResponse');
const { redactForLog } = require('../utils/loggerRedaction');

class SmartOcrService {
  constructor() {
    this.baseUrl = null;
    this.clientId = null;
    this.clientSecret = null;
    this.ocrTimeoutMs = 90_000;
    this.initialized = false;
  }

  initialize(config) {
    this.baseUrl = config.CASHFREE_BASE_URL || getCashfreeBaseUrl(config);
    this.clientId = config.CASHFREE_CLIENT_ID;
    this.clientSecret = config.CASHFREE_CLIENT_SECRET;
    this.ocrTimeoutMs =
      Number.isFinite(config.CASHFREE_OCR_TIMEOUT_MS) && config.CASHFREE_OCR_TIMEOUT_MS > 0
        ? config.CASHFREE_OCR_TIMEOUT_MS
        : 90_000;
    this.initialized = true;
    let cashfreeHost = this.baseUrl;
    try {
      cashfreeHost = new URL(this.baseUrl).host;
    } catch {
      // keep raw baseUrl
    }
    logger.info('Smart OCR service initialized', {
      environment: config.CASHFREE_ENV,
      cashfreeApiHost: cashfreeHost,
      ocrTimeoutMs: this.ocrTimeoutMs,
    });
  }

  getHeaders(contentType) {
    const headers = {
      'x-client-id': this.clientId,
      'x-client-secret': this.clientSecret,
      'x-api-version':
        process.env.CASHFREE_API_VERSION ||
        process.env.CASHFREE_OCR_API_VERSION ||
        '2024-12-01',
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  /**
   * Synchronous Smart OCR call.
   * @param {object} params
   * @param {string} params.verificationId - max 50 chars, unique per call
   * @param {Buffer} params.fileBuffer
   * @param {string} params.mimeType
   * @param {string} [params.documentType='AADHAAR']
   */
  async submitAadhaarOcr({
    verificationId,
    fileBuffer,
    mimeType,
    documentType = 'AADHAAR',
    side = 'front',
  }) {
    if (!this.initialized) throw new Error('Smart OCR service not initialized');

    const form = new FormData();
    form.append('verification_id', verificationId);
    form.append('document_type', documentType);
    form.append('do_verification', 'false');
    form.append('file', fileBuffer, {
      filename: 'aadhaar.jpg',
      contentType: mimeType || 'image/jpeg',
    });

    const url = `${this.baseUrl}/bharat-ocr`;

    logger.info('Smart OCR request', redactForLog({ verificationId, documentType, side }));

    let response;
    try {
      response = await axios.post(url, form, {
        headers: { ...this.getHeaders(), ...form.getHeaders() },
        timeout: this.ocrTimeoutMs || 90_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } catch (err) {
      const status = err.response?.status;
      const cfBody = err.response?.data;
      if (cfBody && typeof cfBody === 'object') {
        logCashfreeResponseToTerminal(cfBody, { verificationId, side, error: true });
        logger.error('Smart OCR Cashfree error body', formatCashfreeResponseForLog(cfBody));
      }
      logger.error('Smart OCR Cashfree error', redactForLog({
        status,
        code: cfBody?.code || err.code,
        message: cfBody?.message || err.message,
        type: cfBody?.type,
        side,
      }));
      const hint =
        status === 403
          ? 'Cashfree 403: enable Smart OCR on your account and whitelist your server IP in Cashfree dashboard (Verification → IP whitelisting).'
          : cfBody?.message || err.message;
      const wrapped = new Error(hint);
      wrapped.statusCode = status || 502;
      wrapped.code = cfBody?.code || err.code;
      throw wrapped;
    }

    const raw = response.data;
    logCashfreeResponseToTerminal(raw, { verificationId, side });
    logger.info('Smart OCR response summary', sanitizeCashfreeResponse(raw));
    logger.info('Smart OCR response detail', formatCashfreeResponseForLog(raw));

    return {
      raw,
      mapped: mapOcrResponse(raw, side),
    };
  }
}

const smartOcrService = new SmartOcrService();
module.exports = smartOcrService;
