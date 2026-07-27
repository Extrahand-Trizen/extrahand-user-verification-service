const assert = require('assert');
const {
  mergeOcrExtracted,
  buildSideExtracted,
  toPublicExtracted,
} = require('../utils/ocrExtractedData');
const { mapOcrResponse } = require('../services/smartOcrMapper');

const frontRaw = {
  document_fields: { name: 'Ada Lovelace', gender: 'F', dob: '1815-12-10', uid: '123456789012' },
  qr_details: {},
};

const backRaw = {
  document_fields: { address: '10 Downing St, London' },
  qr_details: { status: 'UNPROCESSABLE', aadhaar_last_four_digit: '9012' },
};

const frontMapped = mapOcrResponse(frontRaw, 'front');
const backMapped = mapOcrResponse(backRaw, 'back');

const frontEx = buildSideExtracted(frontMapped, frontRaw, 'front');
const backEx = buildSideExtracted(backMapped, backRaw, 'back');
const merged = mergeOcrExtracted(frontEx, backEx);

assert.equal(merged.name, 'Ada Lovelace');
assert.equal(merged.gender, 'F');
assert.equal(merged.dob, '1815-12-10');
assert.equal(merged.aadhaarLast4, '9012');
assert.ok(merged.address && merged.address.line1);

const pub = toPublicExtracted(merged);
assert.equal(pub.name, 'Ada Lovelace');
assert.ok(!('uid' in pub));

console.log('ocrExtractedData.test.js: ok');
