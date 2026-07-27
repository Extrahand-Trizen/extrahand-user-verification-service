const crypto = require('crypto');

/**
 * Generate internal vault storage key (never a URL).
 * aadhaar-ocr/{userId}/{sessionId}/front_{uuid}.jpg
 */
function generateOcrStorageKey({ userId, sessionId, side, extension = 'jpg' }) {
  const safeUser = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
  const safeSession = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '');
  const uuid = crypto.randomUUID().replace(/-/g, '');
  const ext = extension.replace(/^\./, '') || 'jpg';
  const normalizedSide = side === 'back' ? 'back' : 'front';
  return `aadhaar-ocr/${safeUser}/${safeSession}/${normalizedSide}_${uuid}.${ext}`;
}

function extensionFromMime(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return map[mimeType] || 'jpg';
}

module.exports = { generateOcrStorageKey, extensionFromMime };
