const KycSession = require('../models/KycSession');
const kycVaultStorage = require('../services/kycVaultStorage');
const logger = require('../config/logger');

async function purgeDueOcrImages() {
  const now = new Date();
  const sessions = await KycSession.find({
    sessionType: 'aadhaar_ocr',
    'ocr.purgeScheduledAt': { $lte: now },
    'ocr.imagesPurgedAt': { $exists: false },
    $or: [
      { 'ocr.frontImageKey': { $exists: true, $ne: null } },
      { 'ocr.backImageKey': { $exists: true, $ne: null } },
    ],
  }).limit(100);

  let purged = 0;

  for (const session of sessions) {
    const keys = [session.ocr?.frontImageKey, session.ocr?.backImageKey].filter(Boolean);
    await kycVaultStorage.deleteObjects(keys);

    session.ocr = {
      ...session.ocr,
      frontImageKey: undefined,
      backImageKey: undefined,
      imagesPurgedAt: now,
    };
    await session.save();
    purged += 1;
  }

  if (purged > 0) {
    logger.info('OCR image purge job completed', { purged });
  }

  return { purged };
}

module.exports = { purgeDueOcrImages };
