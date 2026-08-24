import { User } from '../models/User';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids visual ambiguity

function randomCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/** Generates a referral code guaranteed unique against the User collection (retries on the rare collision). */
export async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const exists = await User.findOne({ referralCode: code });
    if (!exists) return code;
  }
  // Astronomically unlikely to ever reach here (32^8 possible codes), but fail loudly rather than silently collide.
  throw new Error('Could not generate a unique referral code after 10 attempts.');
}
