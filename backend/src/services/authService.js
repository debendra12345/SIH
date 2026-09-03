const { db, verifyPassword } = require('../config/db');

/**
 * Doctor Authentication Service
 * Authenticates doctor against the database using secure password verification
 */
const authenticateDoctor = async (doctorId, password) => {
  if (!doctorId || !password) return null;

  const normalizedId = String(doctorId).trim().toUpperCase();
  const doctor = db.prepare('SELECT doctorId, name, email, passwordHash, salt, department, room FROM doctors WHERE doctorId = ?').get(normalizedId);

  if (!doctor) {
    return null;
  }

  const isValid = verifyPassword(password, doctor.salt, doctor.passwordHash);
  if (!isValid) {
    return null;
  }

  // Return doctor details without sensitive hash/salt
  return {
    doctorId: doctor.doctorId,
    name: doctor.name,
    email: doctor.email,
    department: doctor.department,
    room: doctor.room
  };
};

module.exports = {
  authenticateDoctor
};
