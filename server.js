// Load environment variables
require('dotenv').config();

const dns = require('node:dns');
const app = require('./app');
const { connectMongo, disconnectMongo } = require('./mongo');
const logger = require('./config/logger');
const { validateEnv } = require('./config/env');

// -----------------------------------------------------------------------------
// Configure Google DNS (helps resolve MongoDB Atlas SRV records on some servers)
// -----------------------------------------------------------------------------
const DNS_FALLBACK_SERVERS = ['8.8.8.8', '8.8.4.4'];

function configureDnsFallback() {
  try {
    dns.setServers(DNS_FALLBACK_SERVERS);
    logger.info(`🌐 Using DNS servers: ${DNS_FALLBACK_SERVERS.join(', ')}`);
  } catch (error) {
    logger.warn(
      '⚠️ Unable to override DNS servers, using system defaults',
      error
    );
  }

  try {
    if (typeof dns.setDefaultResultOrder === 'function') {
      dns.setDefaultResultOrder('ipv4first');
      logger.info('🌐 DNS lookup order set to IPv4 first');
    }
  } catch (error) {
    logger.warn(
      '⚠️ Unable to set IPv4-first DNS lookup order',
      error
    );
  }
}

configureDnsFallback();

// -----------------------------------------------------------------------------
// Validate environment
// -----------------------------------------------------------------------------
const env = validateEnv();
const PORT = env.PORT;

let server;
let isShuttingDown = false;

// -----------------------------------------------------------------------------
// Start Application
// -----------------------------------------------------------------------------
async function start() {
  try {
    // Connect MongoDB (server still starts if MongoDB fails)
    if (env.MONGODB_URI) {
      try {
        logger.info('🔌 Connecting to MongoDB...');
        await connectMongo(env.MONGODB_URI);
        logger.info('✅ Connected to MongoDB');
      } catch (error) {
        logger.error(
          '❌ MongoDB connection failed, continuing in degraded mode:',
          error.message
        );
        logger.warn(
          '⚠️ Some features may be unavailable until MongoDB reconnects.'
        );
      }
    } else {
      logger.warn(
        '⚠️ MONGODB_URI not configured. Running without MongoDB.'
      );
    }

    // Start HTTP Server
    server = app.listen(PORT, () => {
      logger.info(
        `🚀 ExtraHand User Verification Service listening on port ${PORT}`
      );
      logger.info(`Environment: ${env.NODE_ENV}`);
      logger.info(`Cashfree Environment: ${env.CASHFREE_ENV}`);
      logger.info(`Health Check: http://localhost:${PORT}/health`);
      logger.info(
        `API Base: http://localhost:${PORT}/api/v1/verification`
      );
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use`);
      } else {
        logger.error('❌ HTTP Server Error:', error);
      }

      process.exit(1);
    });
  } catch (error) {
    logger.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Graceful Shutdown
// -----------------------------------------------------------------------------
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('⚠️ Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;

  logger.info(`📴 Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    server.close(() => {
      logger.info('✅ HTTP server closed');
    });
  }

  try {
    await disconnectMongo();

    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Process Handlers
// -----------------------------------------------------------------------------
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Promise Rejection');
  logger.error('Promise:', promise);
  logger.error('Reason:', reason);
  process.exit(1);
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------
start().catch((error) => {
  logger.error('💥 Failed to start application:', error);
  process.exit(1);
});