const crypto = require('crypto');

// A demo-only secret is generated per process when JWT_SECRET is not configured.
// This keeps prototype sessions predictable in scope without shipping a reusable secret.
const demoSecret = crypto.randomBytes(32).toString('hex');

function getJwtSecret() {
  return process.env.JWT_SECRET || demoSecret;
}

function isDemoTokenMode() {
  return !process.env.JWT_SECRET;
}

module.exports = { getJwtSecret, isDemoTokenMode };
