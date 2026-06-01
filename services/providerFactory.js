const CashfreeProvider = require('./providers/CashfreeProvider');
const MockProvider = require('./providers/MockProvider');
const logger = require('../config/logger');
const { isVerificationTestMode } = require('../config/env');

/**
 * Provider Factory
 * Returns the appropriate verification provider based on configuration
 * 
 * CURRENTLY ACTIVE:
 * - ✅ Cashfree (default and only active provider)
 * 
 * READY FOR FUTURE:
 * - 🔒 Signzy (uncomment when ready)
 * - 🔒 Karza (uncomment when ready)
 * 
 * TO ACTIVATE A NEW PROVIDER:
 * 1. Get API credentials from provider
 * 2. Rename stub file (remove .stub.js extension)
 * 3. Uncomment the import and case below
 * 4. Add credentials to .env file
 * 5. Set VERIFICATION_PROVIDER=<provider-name> in .env
 * 6. Restart the service
 * 
 * @param {object} config - Configuration object with provider settings
 * @returns {BaseVerificationProvider} Verification provider instance
 */
function getVerificationProvider(config) {
  let providerName = config.VERIFICATION_PROVIDER || 'cashfree';
  if (isVerificationTestMode(config) && providerName === 'cashfree') {
    providerName = 'mock';
    logger.info('🧪 VERIFICATION_TEST_MODE — using mock provider for OTP/PAN/bank flows');
  }

  logger.info(`🔧 Initializing verification provider: ${providerName}`);
  
  switch (providerName.toLowerCase()) {
    case 'mock':
      return new MockProvider(config);

    case 'cashfree':
      return new CashfreeProvider(config);
    
    // ===== FUTURE PROVIDERS (UNCOMMENT WHEN READY) =====
    
    // case 'signzy':
    //   const SignzyProvider = require('./providers/SignzyProvider');
    //   return new SignzyProvider(config);
    
    // case 'karza':
    //   const KarzaProvider = require('./providers/KarzaProvider');
    //   return new KarzaProvider(config);
    
    default:
      logger.warn(`⚠️ Unknown provider: ${providerName}, falling back to Cashfree`);
      return new CashfreeProvider(config);
  }
}

/**
 * Get list of available providers
 * @returns {Array<string>} List of provider names
 */
function getAvailableProviders() {
  return [
    'cashfree',    // ✅ Active
    'mock',        // 🧪 Local / VERIFICATION_TEST_MODE
    // 'signzy',   // 🔒 Ready (uncomment when activated)
    // 'karza',    // 🔒 Ready (uncomment when activated)
  ];
}

/**
 * Check if a provider is available
 * @param {string} providerName - Name of the provider
 * @returns {boolean} True if provider is available
 */
function isProviderAvailable(providerName) {
  return getAvailableProviders().includes(providerName.toLowerCase());
}

/**
 * Get provider capabilities
 * @param {string} providerName - Name of the provider
 * @returns {object} Provider capabilities
 */
function getProviderCapabilities(providerName) {
  const capabilities = {
    mock: {
      aadhaar: true,
      pan: true,
      bank: true,
      face: true,
    },
    cashfree: {
      aadhaar: true,
      pan: true,        // Ready but feature-flagged
      bank: true,       // Ready but feature-flagged
      face: false,      // Not supported by Cashfree
    },
    signzy: {
      aadhaar: true,
      pan: true,
      bank: true,
      face: true,       // Signzy supports face verification
    },
    karza: {
      aadhaar: true,
      pan: true,
      bank: true,
      face: true,       // Karza supports face verification
    },
  };

  return capabilities[providerName.toLowerCase()] || {
    aadhaar: false,
    pan: false,
    bank: false,
    face: false,
  };
}

module.exports = {
  getVerificationProvider,
  getAvailableProviders,
  isProviderAvailable,
  getProviderCapabilities,
};

