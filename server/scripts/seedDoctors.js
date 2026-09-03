const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const User = require('../models/User');

// Load environment variables from server/.env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DOCTORS_DATA = [
  {
    name: 'Aryan Kumar Lohar',
    doctorId: 'DOC-1001',
    email: 'aryanvines32@gmail.com',
    mobileNumber: '7665778969',
    role: 'doctor',
    isActive: true,
    tempPassword: process.env.DOC_1001_PASS || 'Aryan#2026!x8k2',
  },
  {
    name: 'Debendra Nath Bandyopadhyay',
    doctorId: 'DOC-1002',
    email: 'rumibandyopadhyay@gmail.com',
    mobileNumber: '9830193679',
    role: 'doctor',
    isActive: true,
    tempPassword: process.env.DOC_1002_PASS || 'Deben#2026!m9p4',
  },
  {
    name: 'Harshita Jaiswal',
    doctorId: 'DOC-1003',
    email: 'harshitajaiswal973@gmail.com',
    mobileNumber: '7017005575',
    role: 'doctor',
    isActive: true,
    tempPassword: process.env.DOC_1003_PASS || 'Harsh#2026!v3q7',
  },
  {
    name: 'Aarav Tyagi',
    doctorId: 'DOC-1004',
    email: 'aaravtyagi00016@gmail.com',
    mobileNumber: '9759977500',
    role: 'doctor',
    isActive: true,
    tempPassword: process.env.DOC_1004_PASS || 'Aarav#2026!w6r1',
  },
  {
    name: 'Aman Singh',
    doctorId: 'DOC-1005',
    email: 'amansinghani4@gmail.com',
    mobileNumber: '9875410323',
    role: 'doctor',
    isActive: true,
    tempPassword: process.env.DOC_1005_PASS || 'AmanS#2026!z2y5',
  },
];

async function seedDoctors() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is not set in environment variables.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB Atlas...');
  try {
    await mongoose.connect(uri);
    console.log('✔ Connected to MongoDB successfully.\n');

    const results = [];

    // Remove old doctor DOC-1042 (Dr. Riya Mehta) and any doctors not in official list
    const allowedDoctorIds = DOCTORS_DATA.map(d => d.doctorId);
    const deleteResult = await User.deleteMany({
      role: 'doctor',
      doctorId: { $nin: allowedDoctorIds },
    });
    if (deleteResult.deletedCount > 0) {
      console.log(`✔ Removed ${deleteResult.deletedCount} old doctor record(s) including DOC-1042.`);
    }

    for (const doc of DOCTORS_DATA) {
      // Find existing user by doctorId or email
      let user = await User.findOne({
        $or: [{ doctorId: doc.doctorId }, { email: doc.email.toLowerCase() }],
      });

      if (user) {
        // Idempotent update: update fields and reset password to intended temp password
        user.name = doc.name;
        user.doctorId = doc.doctorId;
        user.email = doc.email.toLowerCase();
        user.mobileNumber = doc.mobileNumber;
        user.role = 'doctor';
        user.isActive = true;
        user.password = doc.tempPassword; // triggers pre('save') bcrypt hashing
        await user.save();

        console.log(`✔ Updated existing doctor: ${doc.name} (${doc.doctorId})`);
        results.push({
          doctorId: doc.doctorId,
          name: doc.name,
          email: doc.email,
          mobile: doc.mobileNumber,
          status: 'updated',
        });
      } else {
        // Create new doctor
        user = await User.create({
          name: doc.name,
          doctorId: doc.doctorId,
          email: doc.email.toLowerCase(),
          mobileNumber: doc.mobileNumber,
          role: 'doctor',
          isActive: true,
          password: doc.tempPassword, // triggers pre('save') bcrypt hashing
        });

        console.log(`✔ Created new doctor: ${doc.name} (${doc.doctorId})`);
        results.push({
          doctorId: doc.doctorId,
          name: doc.name,
          email: doc.email,
          mobile: doc.mobileNumber,
          status: 'created',
        });
      }
    }

    console.log('\n--- Doctor Accounts Summary ---');
    results.forEach((r) => {
      console.log(`[${r.status.toUpperCase()}] ${r.doctorId} - ${r.name} (${r.email}, ${r.mobile})`);
    });

    await mongoose.connection.close();
    console.log('\n✔ Database connection closed cleanly.');
    return results;
  } catch (err) {
    console.error('❌ Seed operation failed:', err.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    throw err;
  }
}

if (require.main === module) {
  seedDoctors()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seedDoctors, DOCTORS_DATA };
