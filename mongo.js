const mongoose = require('mongoose');
const logger = require('./config/logger');

let isConnected = false;

async function connectMongo(uri) {
  if (!uri) {
    logger.warn('MONGODB_URI not set; running without MongoDB (in-memory fallback)');
    return null;
  }
  
  if (isConnected) {
    logger.debug('MongoDB already connected');
    return mongoose.connection;
  }
  
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB || 'extrahand_verifications',
    });
    isConnected = true;
    logger.info('✅ Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    logger.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

async function disconnectMongo() {
  if (isConnected && mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
      isConnected = false;
      logger.info('✅ MongoDB connection closed');
    } catch (error) {
      logger.error('❌ Error closing MongoDB connection:', error);
      throw error;
    }
  }
}

module.exports = { connectMongo, disconnectMongo };

