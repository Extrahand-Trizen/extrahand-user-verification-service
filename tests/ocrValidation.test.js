const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOcrMappedResult, validateFrontBackConsistency } = require('../services/ocrValidationService');
const { mapOcrResponse } = require('../services/smartOcrMapper');
const { sanitizeCashfreeResponse, buildPersistableOcrMetadata } = require('../utils/sanitizeCashfreeResponse');
const { maskFromLastFour } = require('../utils/masking');

test('maskFromLastFour formats correctly', () => {
  assert.equal(maskFromLastFour('1234'), 'XXXX XXXX 1234');
});

test('sanitizeCashfreeResponse redacts uid and photo_link', () => {
  const sanitized = sanitizeCashfreeResponse({
    verification_status: 'VALID',
    document_fields: { uid: '123456789012', name: 'Test User' },
    qr_details: { status: 'SECURE', aadhaar_last_four_digit: '5678', photo_link: 'https://secret' },
    fraud_checks: { is_forged: false, blur: false },
  });
  assert.equal(sanitized.sanitized, true);
  assert.ok(!JSON.stringify(sanitized).includes('123456789012'));
  assert.ok(!JSON.stringify(sanitized).includes('photo_link'));
  assert.equal(sanitized.maskedAadhaar, 'XXXX XXXX 5678');
});

test('validateOcrMappedResult is permissive on blur', () => {
  const mapped = mapOcrResponse({
    verification_status: 'VALID',
    quality_checks: { blur: true, glare: true },
    fraud_checks: { is_forged: false },
    qr_details: { status: 'SECURE', aadhaar_last_four_digit: '1234' },
  });
  const result = validateOcrMappedResult(mapped);
  assert.equal(result.accepted, true);
  assert.ok(result.warnings.length > 0);
});

test('validateOcrMappedResult rejects forged', () => {
  const mapped = mapOcrResponse({
    verification_status: 'VALID',
    fraud_checks: { is_forged: true },
  });
  const result = validateOcrMappedResult(mapped);
  assert.equal(result.accepted, false);
  assert.equal(result.code, 'FRAUD_HARD_REJECT');
});

test('validateFrontBackConsistency detects mismatch', () => {
  const r = validateFrontBackConsistency(
    { maskedAadhaar: 'XXXX XXXX 1111' },
    { maskedAadhaar: 'XXXX XXXX 2222' }
  );
  assert.equal(r.accepted, false);
});

test('buildPersistableOcrMetadata has no raw uid', () => {
  const mapped = mapOcrResponse({
    verification_status: 'VALID',
    document_fields: { uid: '123456789012' },
    qr_details: { aadhaar_last_four_digit: '9012' },
  });
  const meta = buildPersistableOcrMetadata(mapped);
  assert.ok(meta.maskedAadhaar);
  assert.ok(!JSON.stringify(meta).includes('123456789012'));
});
