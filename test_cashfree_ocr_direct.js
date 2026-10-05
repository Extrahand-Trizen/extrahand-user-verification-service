const dotenv = require('dotenv');
dotenv.config();

const smartOcrService = require('./services/smartOcrService');
const env = require('./config/env').validateEnv();

smartOcrService.initialize(env);

// Create a valid 100x100 JPEG image buffer using Jimp
const { Jimp } = require('jimp');

async function testDirectCashfreeCall() {
  console.log('🧪 Starting direct test call to Cashfree /bharat-ocr...');

  try {
    const image = new Jimp({ width: 200, height: 120, color: 0xffffffff });
    const buffer = await image.getBuffer('image/jpeg');

    console.log(`📸 Sample JPEG Image Buffer Created (${buffer.length} bytes)`);

    const result = await smartOcrService.submitAadhaarOcr({
      verificationId: `eh_test_${Date.now()}`,
      fileBuffer: buffer,
      mimeType: 'image/jpeg',
      side: 'front',
    });

    console.log('✅ Cashfree Response Received:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('❌ Cashfree Error Captured:');
    console.error('Status:', err.statusCode || err.response?.status);
    console.error('Code:', err.code);
    console.error('Message:', err.message);
  }
}

testDirectCashfreeCall();
