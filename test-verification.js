// Test script for Verification Service
// Tests the complete Aadhaar verification flow

const http = require('http');

const SERVICE_URL = 'http://localhost:4004';
const SERVICE_AUTH = 'test-shared-secret-token-12345-change-in-production';
const USER_ID = 'test-user-123';
const TEST_AADHAAR = '655675523712';
const TEST_OTP = '111000';

function makeRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    
    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testVerification() {
  console.log('🧪 Testing Verification Service');
  console.log('================================\n');

  try {
    // Step 1: Health Check
    console.log('1️⃣ Testing Health Check...');
    const health = await makeRequest({
      hostname: 'localhost',
      port: 4004,
      path: '/health',
      method: 'GET'
    });
    console.log('✅ Health Check:', JSON.stringify(health.data, null, 2));
    console.log('');

    // Step 2: Initiate Verification
    console.log('2️⃣ Initiating Aadhaar Verification...');
    console.log(`   Aadhaar: ${TEST_AADHAAR}`);
    const initiate = await makeRequest({
      hostname: 'localhost',
      port: 4004,
      path: '/api/v1/verification/aadhaar/initiate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': SERVICE_AUTH,
        'X-User-Id': USER_ID
      }
    }, {
      aadhaarNumber: TEST_AADHAAR,
      consentGiven: true
    });

    console.log('Response:', JSON.stringify(initiate.data, null, 2));
    
    if (!initiate.data.success || !initiate.data.data?.refId) {
      console.error('❌ Failed to initiate verification');
      console.error('Response:', initiate.data);
      process.exit(1);
    }

    const refId = initiate.data.data.refId;
    console.log(`✅ Got refId: ${refId}\n`);

    // Step 3: Verify OTP
    console.log('3️⃣ Verifying OTP...');
    console.log(`   refId: ${refId}`);
    console.log(`   OTP: ${TEST_OTP}`);
    const verify = await makeRequest({
      hostname: 'localhost',
      port: 4004,
      path: '/api/v1/verification/aadhaar/verify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': SERVICE_AUTH,
        'X-User-Id': USER_ID
      }
    }, {
      refId: refId,
      otp: TEST_OTP
    });

    console.log('Response:', JSON.stringify(verify.data, null, 2));
    console.log('');

    // Step 4: Check Status
    console.log('4️⃣ Checking Verification Status...');
    const status = await makeRequest({
      hostname: 'localhost',
      port: 4004,
      path: `/api/v1/verification/status/${USER_ID}`,
      method: 'GET',
      headers: {
        'X-Service-Auth': SERVICE_AUTH
      }
    });
    console.log('Response:', JSON.stringify(status.data, null, 2));
    console.log('');

    // Step 5: Check Badge
    console.log('5️⃣ Checking Verification Badge...');
    const badge = await makeRequest({
      hostname: 'localhost',
      port: 4004,
      path: `/api/v1/verification/badge/${USER_ID}`,
      method: 'GET',
      headers: {
        'X-Service-Auth': SERVICE_AUTH
      }
    });
    console.log('Response:', JSON.stringify(badge.data, null, 2));
    console.log('');

    console.log('✅ Testing Complete!');
    
    // Summary
    if (verify.data.success && verify.data.data?.status === 'verified') {
      console.log('\n🎉 Verification Successful!');
      console.log(`   User: ${USER_ID}`);
      console.log(`   Status: ${verify.data.data.status}`);
      if (verify.data.data.maskedAadhaar) {
        console.log(`   Aadhaar: ${verify.data.data.maskedAadhaar}`);
      }
    } else {
      console.log('\n⚠️ Verification may have failed. Check the response above.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Make sure the verification service is running on port 4004');
    process.exit(1);
  }
}

// Run tests
testVerification();

