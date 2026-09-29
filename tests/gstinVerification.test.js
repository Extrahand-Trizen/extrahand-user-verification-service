const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidGstinFormat,
  cleanGstinNumber,
  maskGSTIN
} = require('../utils/validation');
const MockProvider = require('../services/providers/MockProvider');
const CashfreeProvider = require('../services/providers/CashfreeProvider');
const { getVerificationProvider, getProviderCapabilities } = require('../services/providerFactory');

test('cleanGstinNumber handles spaces and lowercase', () => {
  assert.equal(cleanGstinNumber(' 29aaicp2912r1zr '), '29AAICP2912R1ZR');
  assert.equal(cleanGstinNumber('29-AAICP-2912R1ZR'), '29AAICP2912R1ZR');
  assert.equal(cleanGstinNumber(''), '');
  assert.equal(cleanGstinNumber(null), '');
});

test('isValidGstinFormat validates standard 15-character GSTIN', () => {
  // Valid formats
  assert.equal(isValidGstinFormat('29AAICP2912R1ZR'), true);
  assert.equal(isValidGstinFormat('27AABCU9603R1ZN'), true);
  assert.equal(isValidGstinFormat('36AAACB8506M1ZP'), true);
  assert.equal(isValidGstinFormat('07AAAAA0000A1Z5'), true);

  // Invalid formats
  assert.equal(isValidGstinFormat('29AAICP2912R1Z'), false); // 14 chars
  assert.equal(isValidGstinFormat('29AAICP2912R1ZRR'), false); // 16 chars
  assert.equal(isValidGstinFormat('29AAICP2912R11R'), false); // 14th char not Z
  assert.equal(isValidGstinFormat(''), false);
  assert.equal(isValidGstinFormat(null), false);
});

test('maskGSTIN masks sensitive characters correctly', () => {
  const masked = maskGSTIN('29AAICP2912R1ZR');
  assert.equal(masked, '29XXXXXXXXXR1ZR');
  assert.equal(masked.length, 15);
  assert.equal(maskGSTIN('invalid'), 'XXXXXXXXXXXXXXX');
});

test('CashfreeProvider reports GSTIN capability and initializes correctly', () => {
  const provider = new CashfreeProvider({
    CASHFREE_CLIENT_ID: 'dummy-id',
    CASHFREE_CLIENT_SECRET: 'dummy-secret',
    CASHFREE_ENV: 'sandbox'
  });

  assert.equal(provider.hasGSTINSupport(), true);
  assert.equal(provider.hasPANSupport(), true);
  const info = provider.getProviderInfo();
  assert.equal(info.capabilities.gstin, true);
  assert.equal(info.capabilities.pan, true);
});

test('CashfreeProvider sandbox verifyGSTIN handles test GSTINs', async () => {
  const provider = new CashfreeProvider({
    CASHFREE_CLIENT_ID: 'dummy-id',
    CASHFREE_CLIENT_SECRET: 'dummy-secret',
    CASHFREE_ENV: 'sandbox'
  });

  const successResult = await provider.verifyGSTIN('29AAICP2912R1ZR', 'Acme Store');
  assert.equal(successResult.success, true);
  assert.equal(successResult.data.gstin, '29AAICP2912R1ZR');
  assert.equal(successResult.data.status, 'Active');

  const failResult = await provider.verifyGSTIN('00AAAAA0000A1Z0');
  assert.equal(failResult.success, false);
});

test('MockProvider verifyGSTIN verifies valid test GSTINs', async () => {
  const provider = new MockProvider();
  assert.equal(provider.hasGSTINSupport(), true);

  const result = await provider.verifyGSTIN('29AAICP2912R1ZR', 'Test Store');
  assert.equal(result.success, true);
  assert.equal(result.data.gstin, '29AAICP2912R1ZR');
  assert.equal(result.data.status, 'Active');
  assert.equal(result.data.maskedGSTIN, '29XXXXXXXXXR1ZR');

  const invalid = await provider.verifyGSTIN('00AAAAA0000A1Z0');
  assert.equal(invalid.success, false);
});

test('MockProvider is strictly forbidden when NODE_ENV is production', () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => {
      new MockProvider();
    }, /MockProvider cannot be initialized in production environment/);

    assert.throws(() => {
      getVerificationProvider({ VERIFICATION_PROVIDER: 'mock', NODE_ENV: 'production' });
    }, /MockProvider is strictly forbidden in production environment/);
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('getProviderCapabilities reports gstin support', () => {
  const cfCap = getProviderCapabilities('cashfree');
  assert.equal(cfCap.gstin, true);
  assert.equal(cfCap.pan, true);

  const mockCap = getProviderCapabilities('mock');
  assert.equal(mockCap.gstin, true);
});
