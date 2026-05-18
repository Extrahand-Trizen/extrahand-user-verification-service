/**
 * Private KYC vault storage configuration.
 * Separate from user-service public media buckets.
 */

const KYC_VAULT_CONFIG = {
  bucketName: process.env.KYC_VAULT_BUCKET_NAME || 'extrahand-kyc-vault',
  endpoint: process.env.KYC_VAULT_ENDPOINT || process.env.MINIO_ENDPOINT || '',
  port: process.env.KYC_VAULT_PORT || process.env.MINIO_PORT || '9000',
  useSSL: (process.env.KYC_VAULT_USE_SSL || process.env.MINIO_USE_SSL || 'false').toLowerCase() === 'true',
  accessKeyId:
    process.env.KYC_VAULT_ACCESS_KEY ||
    process.env.MINIO_ACCESS_KEY ||
    process.env.MINIO_ROOT_USER ||
    '',
  secretAccessKey:
    process.env.KYC_VAULT_SECRET_KEY ||
    process.env.MINIO_SECRET_KEY ||
    process.env.MINIO_ROOT_PASSWORD ||
    '',
  region: process.env.KYC_VAULT_REGION || process.env.MINIO_REGION_NAME || 'us-east-1',
  keyPrefix: 'aadhaar-ocr',
  maxUploadBytes: parseInt(process.env.KYC_VAULT_MAX_UPLOAD_BYTES, 10) || 5 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
};

module.exports = { KYC_VAULT_CONFIG };
