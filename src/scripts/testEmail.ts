import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendOtpEmail } from '../utils/email';

/**
 * 
 * testEmail.ts
 * ------------
 * Standalone check for the Resend config — sends one real OTP-style email
 * with no DB, no server, no register/login flow involved. Run this first
 * whenever "OTP isn't arriving" is reported: it isolates whether the
 * problem is Resend config (this script) or something else in the request
 * flow (DB write, rate limiting, etc.).
 *
 * Usage:
 *   npx ts-node src/scripts/testEmail.ts you@example.com
 */
async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: npx ts-node src/scripts/testEmail.ts <recipient-email>');
    process.exit(1);
  }

  if (!env.resendApiKey) {
    logger.error(
      'RESEND_API_KEY is NOT set in .env. Set it first — see backend/.env.example.'
    );
    process.exit(1);
  }

  logger.info(`Sending a test OTP email to ${to} via Resend (from ${env.emailFrom})...`);
  const testOtp = '123456';
  await sendOtpEmail(to, testOtp);
  logger.info('Done. Check the recipient inbox (and spam folder) for a code "123456". Check the log lines above for send success/failure.');
}

main().catch((err) => {
  logger.error('testEmail script failed', err);
  process.exit(1);
});
