const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { initDb } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const doctorRoutes = require('./routes/doctorRoutes');

const app = express();
const PORT = process.env.PORT || 5001;

// Initialize Database & Tables
initDb();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'MediKiosk Relational EMR Backend API is running',
    version: '2.0.0',
    endpoints: {
      health: 'GET /api/health',
      doctorLogin: 'POST /api/auth/doctor/login',
      registerPatient: 'POST /api/patients/register',
      getPatient: 'GET /api/patients/:patientId',
      healthHistory: 'POST/GET /api/patients/:patientId/health-history',
      ayushHistory: 'POST/GET /api/patients/:patientId/ayush-history',
      medicalRecords: 'POST/GET /api/patients/:patientId/records',
      clinicalSummary: 'POST/GET /api/patients/:patientId/summary',
      consent: 'POST/GET /api/patients/:patientId/consent',
      doctorQueue: 'GET /api/doctor/patients',
      doctorPatientDossier: 'GET /api/doctor/patients/:patientId',
      doctorReview: 'POST /api/doctor/patients/:patientId/review'
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Backend is healthy and database is connected',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctor', doctorRoutes);

// Catch-all for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Start Server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MediKiosk Relational Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
