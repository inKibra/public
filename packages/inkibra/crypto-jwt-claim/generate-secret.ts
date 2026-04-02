import crypto from 'crypto';

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

const secret = generateSecret();
console.log('Auth Signing Secret:\n', secret);
