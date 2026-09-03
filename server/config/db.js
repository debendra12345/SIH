const mongoose = require('mongoose');

/**
 * Connect to MongoDB database using Mongoose
 * Reads connection string from process.env.MONGO_URI or process.env.MONGODB_URI
 */
const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!uri) {
    console.error('Database connection error: MONGO_URI is not defined in environment variables.');
    throw new Error('MONGO_URI is required to connect to the database.');
  }

  mongoose.connection.on('error', (err) => {
    console.error(`MongoDB runtime connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected.');
  });

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`MongoDB Initial Connection Error: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
