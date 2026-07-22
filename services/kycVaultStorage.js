/**
 * Private KYC vault — internal-only object storage.
 * No public URLs, no presigned GET for clients, keys only in MongoDB.
 */

const AWS = require('aws-sdk');
const logger = require('../config/logger');
const { KYC_VAULT_CONFIG } = require('../config/kycVault.config');
const { redactForLog } = require('../utils/loggerRedaction');

class KycVaultStorage {
  constructor() {
    this.s3 = null;
    this.initialized = false;
    this.bucketName = KYC_VAULT_CONFIG.bucketName;
  }

  initialize() {
    const { endpoint, useSSL, accessKeyId, secretAccessKey, region, bucketName } =
      KYC_VAULT_CONFIG;

    if (!accessKeyId || !secretAccessKey) {
      logger.warn('KYC vault credentials not configured — OCR image storage disabled');
      return;
    }

    const rawPort = process.env.KYC_VAULT_PORT || process.env.MINIO_PORT || '';
    let protocol = useSSL ? 'https' : 'http';
    let host = 'localhost';
    let resolvedPort = rawPort || '9000';

    if (endpoint) {
      try {
        if (endpoint.includes('://')) {
          const url = new URL(endpoint);
          host = url.hostname;
          protocol = url.protocol.replace(':', '') || protocol;
          // Public HTTPS MinIO (CapRover/nginx): no :9000 — use implicit 443/80.
          resolvedPort = url.port || rawPort || '';
        } else {
          host = endpoint;
          if (!rawPort) resolvedPort = '9000';
        }
      } catch {
        host = endpoint;
      }
    }

    const endpointString = `${protocol}://${host}${resolvedPort ? `:${resolvedPort}` : ''}`;

    this.s3 = new AWS.S3({
      endpoint: endpointString,
      accessKeyId,
      secretAccessKey,
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
      region,
    });
    this.bucketName = bucketName;
    this.initialized = true;

    logger.info('KYC vault storage initialized', redactForLog({ bucket: bucketName, endpoint: endpointString }));
  }

  async ensureBucket() {
    if (!this.initialized) throw new Error('KYC vault not initialized');
    try {
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
    } catch (err) {
      if (err.statusCode === 404 || err.code === 'NotFound' || err.code === 'NoSuchBucket') {
        await this.s3
          .createBucket({ Bucket: this.bucketName })
          .promise();
        logger.info('KYC vault bucket created', { bucket: this.bucketName });
      } else {
        throw err;
      }
    }
    // Private bucket — block public ACL/policy (no public-read)
    try {
      await this.s3
        .putPublicAccessBlock({
          Bucket: this.bucketName,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        })
        .promise();
    } catch (e) {
      logger.warn('Could not set public access block on KYC vault', { error: e.message });
    }
  }

  /**
   * @param {string} key - internal storage key
   * @param {Buffer} buffer
   * @param {string} contentType
   */
  async putObject(key, buffer, contentType) {
    if (!this.initialized) throw new Error('KYC vault not initialized');
    await this.ensureBucket();
    const putParams = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    };
    // MinIO without KMS rejects SSE; bucket is private (no public URLs). Opt-in for AWS S3:
    if (process.env.KYC_VAULT_SSE_AES256 === 'true') {
      putParams.ServerSideEncryption = 'AES256';
    }
    await this.s3.putObject(putParams).promise();
    return { key };
  }

  /**
   * Internal read for OCR processing only — never expose to API responses.
   */
  async getObjectBuffer(key) {
    if (!this.initialized) throw new Error('KYC vault not initialized');
    const result = await this.s3
      .getObject({ Bucket: this.bucketName, Key: key })
      .promise();
    return result.Body;
  }

  async deleteObject(key) {
    if (!this.initialized || !key) return;
    try {
      await this.s3.deleteObject({ Bucket: this.bucketName, Key: key }).promise();
    } catch (e) {
      logger.warn('KYC vault delete failed', redactForLog({ key, error: e.message }));
    }
  }

  async deleteObjects(keys = []) {
    const unique = [...new Set(keys.filter(Boolean))];
    await Promise.all(unique.map((k) => this.deleteObject(k)));
  }
}

const kycVaultStorage = new KycVaultStorage();
module.exports = kycVaultStorage;
