/**
 * Cashfree-shaped Smart OCR fixtures for local VERIFICATION_TEST_MODE.
 * No HTTP calls — avoids sandbox IP whitelisting during dev.
 */

/** Cashfree sandbox valid test Aadhaar (see MockProvider) */
const TEST_AADHAAR_FULL = '655675523712';
const TEST_LAST_FOUR = TEST_AADHAAR_FULL.slice(-4);

function buildMockOcrRaw({ verificationId, side }) {
  const base = {
    verification_id: verificationId,
    verification_status: 'VALID',
    document_type: 'AADHAAR',
    reference_id: `MOCK_REF_${verificationId}`,
    document_fields: {
      uid: TEST_AADHAAR_FULL,
      name: 'Test User',
      dob: '1990-01-15',
      gender: 'M',
    },
    qr_details: {
      status: 'SECURE',
      aadhaar_last_four_digit: TEST_LAST_FOUR,
      name: 'Test User',
      dob: '1990-01-15',
      gender: 'M',
    },
    fraud_checks: {
      is_forged: false,
      blur: false,
      black_and_white: false,
    },
    quality_checks: {
      blur: false,
      glare: false,
      partial_document: false,
    },
  };

  if (side === 'back') {
    const address = '12 Test Nagar, Bengaluru, Karnataka 560001';
    base.document_fields = {
      ...base.document_fields,
      address,
    };
    base.qr_details = {
      ...base.qr_details,
      address,
      structured_address: {
        house: '12 Test Nagar',
        district: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    };
  }

  return base;
}

module.exports = {
  TEST_AADHAAR_FULL,
  TEST_LAST_FOUR,
  buildMockOcrRaw,
};
