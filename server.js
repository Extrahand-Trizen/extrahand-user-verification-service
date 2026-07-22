// Load environment variables
require('dotenv').config();

const app = require('./app');
const { connectMongo, disconnectMongo } = require('./mongo');
const logger = require('./config/logger');
const { validateEnv } = require('./config/env');

// Validate environment on startup
const env = validateEnv();

const PORT = env.PORT;

let server;
let isShuttingDown = false;

async function start() {
  try {
    // Connect to MongoDB if configured (non-blocking - server will start even if MongoDB fails)
    if (env.MONGODB_URI) {
      try {
        await connectMongo(env.MONGODB_URI);
        logger.info('✅ Connected to MongoDB');
      } catch (error) {
        logger.error('❌ MongoDB connection failed, but continuing to start server:', error.message);
        logger.warn('⚠️ Server will run in degraded mode without MongoDB. Some features may be unavailable.');
        // Don't throw - allow server to start in degraded mode
      }
    } else {
      logger.warn('⚠️ MONGODB_URI not set; running without MongoDB (in-memory fallback)');
    }

    // Start HTTP server (always start, even if MongoDB failed)
    server = app.listen(PORT, () => {
      logger.info(`🚀 ExtraHand User Verification Service listening on port ${PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
      logger.info(`Cashfree Environment: ${env.CASHFREE_ENV}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`API Base: http://localhost:${PORT}/api/v1/verification`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use`);
      } else {
        logger.error('❌ Server error:', error);
      }
      process.exit(1);
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  logger.info(`📴 Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      logger.info('✅ HTTP server closed');
    });
  }

  try {
    // Close database connections
    await disconnectMongo();

    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
start().catch((error) => {
  logger.error('💥 Failed to start application:', error);
  process.exit(1);
});

