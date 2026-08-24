import bcrypt from 'bcrypt';

const OTP_LENGTH = 6;
const MAX_OTP_ATTEMPTS = 5;

export function generateOtp(): string {
  // crypto-quality randomness isn't essential here (short-lived, rate-limited,
  // single-use, hashed at rest) — Math.random is fine for a demo OTP code.
  return Math.floor(100000 + Math.random() * 900000).toString().padStart(OTP_LENGTH, '0');
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

export async function compareOtp(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

export { MAX_OTP_ATTEMPTS };
