// backend/config/database.js

const mongoose = require('mongoose');

let isConnected = false;
let retryCount = 0;
const MAX_RETRIES = 10;
const RETRY_INTERVAL = 5000;

const connectDB = async () => {
  if (isConnected) {
    console.log('MongoDB already connected ✅');
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      family: 4, // ✅ Force IPv4 - fixes ENOTFOUND
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      retryReads: true,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      heartbeatFrequencyMS: 10000,
    });

    isConnected = true;
    retryCount = 0;
    console.log('MongoDB Connected ✅');

    // ✅ Handle connection events
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected! Attempting to reconnect...');
      isConnected = false;
      setTimeout(connectDB, RETRY_INTERVAL);
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err.message);
      if (!isConnected) {
        setTimeout(connectDB, RETRY_INTERVAL);
      }
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
      isConnected = true;
    });

  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    isConnected = false;

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`🔄 Retry ${retryCount}/${MAX_RETRIES} in ${RETRY_INTERVAL/1000}s...`);
      setTimeout(connectDB, RETRY_INTERVAL);
    } else {
      console.error('❌ Max retries reached. Please check your MongoDB connection.');
    }
  }
};

module.exports = connectDB;