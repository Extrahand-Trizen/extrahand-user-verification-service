const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hashAadhaarDigits,
  hashAadhaarInput,
  normalizeAadhaarDigits,
  extractAadhaarDigitsFromOcr,
  buildAadhaarIdentityHash,
  buildAadhaarFingerprintFromOcr,
  buildAadhaarFingerprintFromVerification,
  DUPLICATE_MESSAGE,
  DUPLICATE_CODE,
} = require('../utils/aadhaarHash');

test('normalizeAadhaarDigits accepts 12-digit values with spaces', () => {
  assert.equal(normalizeAadhaarDigits('1234 5678 9012'), '123456789012');
  assert.equal(normalizeAadhaarDigits('XXXX XXXX 9012'), null);
});

test('hashAadhaarDigits is deterministic for same input', () => {
  const first = hashAadhaarDigits('123456789012');
  const second = hashAadhaarDigits('1234 5678 9012');
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('identity hash works from masked-card OCR fields only', () => {
  const raw = {
    document_fields: {
      name: 'John Doe',
      dob: '2004-10-02',
    },
    qr_details: {
      status: 'SECURE',
      name: 'John Doe',
      dob: '2004-10-02',
      aadhaar_last_four_digit: '9012',
    },
  };

  const mapped = {
    maskedAadhaar: 'XXXX XXXX 9012',
    name: 'John Doe',
    dob: '2004-10-02',
  };

  const fingerprint = buildAadhaarFingerprintFromOcr({ mapped, raw, merged: mapped });
  assert.equal(fingerprint.aadhaarHash, null);
  assert.ok(fingerprint.aadhaarIdentityHash);
  assert.equal(fingerprint.aadhaarLast4, '9012');
});

test('legacy verification records produce the same identity hash', () => {
  const incoming = buildAadhaarFingerprintFromOcr({
    mapped: {
      maskedAadhaar: 'XXXX XXXX 9012',
      name: 'John Doe',
      dob: '2004-10-02',
    },
    merged: {
      name: 'John Doe',
      dob: '2004-10-02',
      aadhaarLast4: '9012',
    },
  });

  const existing = buildAadhaarFingerprintFromVerification({
    maskedAadhaar: 'XXXX XXXX 9012',
    verifiedData: {
      name: 'John Doe',
      dob: '2004-10-02',
    },
    status: 'verified',
  });

  assert.equal(incoming.aadhaarIdentityHash, existing.aadhaarIdentityHash);
});

test('extractAadhaarDigitsFromOcr reads uid from mapper omit bucket', () => {
  const mapped = { _omit: { uid: '9876 5432 1098' } };
  assert.equal(extractAadhaarDigitsFromOcr(mapped, null), '987654321098');
});

test('duplicate constants match product copy', () => {
  assert.equal(DUPLICATE_CODE, 'AADHAAR_ALREADY_REGISTERED');
  assert.match(DUPLICATE_MESSAGE, /already used with another account/i);
});

test('buildAadhaarIdentityHash is stable', () => {
  const a = buildAadhaarIdentityHash({ name: 'John Doe', dob: '2004-10-02', last4: '9012' });
  const b = buildAadhaarIdentityHash({ name: 'john doe', dob: '02-10-2004', last4: '9012' });
  assert.equal(a, b);
});

test('hashAadhaarInput returns null for masked values', () => {
  assert.equal(hashAadhaarInput('XXXX XXXX 1234'), null);
});
