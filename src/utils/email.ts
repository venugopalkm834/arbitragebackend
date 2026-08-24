import { Resend } from 'resend';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * email.ts
 * ---------
 * Sends the registration-verification OTP and password-reset emails via
 * Resend. If RESEND_API_KEY is NOT set in .env, the "email" is logged to
 * the server console instead, so these flows are still fully testable
 * locally without needing a real Resend account. Before relying on real
 * email delivery in production, set a real RESEND_API_KEY.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!env.resendApiKey) return null;
  if (!client) {
    client = new Resend(env.resendApiKey);
  }
  return client;
}

/** Call once at server boot so a missing Resend config is visible immediately, not just when the first user tries to register. */
export function logEmailConfigStatus(): void {
  if (!env.resendApiKey) {
    logger.warn('RESEND_API_KEY is NOT set — OTP/reset codes will only be logged to this console, never actually emailed. Set RESEND_API_KEY in .env before relying on email delivery.');
    return;
  }
  logger.info('Resend is configured — OTP/reset emails will be sent for real.');
}

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const subject = 'Your ArbitreX verification code';
  const html = `
    <div style="font-family:sans-serif;max-width:420px;margin:0 auto;">
      <h2 style="color:#0f2a5e;">ArbitreX Verification Code</h2>
      <p>Use the code below to finish signing in:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:6px;color:#1d4ed8;">${otp}</p>
      <p style="color:#6b7280;font-size:13px;">This code expires in ${env.twoFactorOtpExpiresMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>
    </div>`;

  const resend = getClient();
  if (!resend) {
    // No Resend key configured — log instead of sending, so local/demo use still works.
    logger.info(`[DEV EMAIL — no RESEND_API_KEY configured] To: ${to} | Subject: ${subject} | Code: ${otp}`);
    return;
  }

  try {
    const { data, error } = await resend.emails.send({ from: env.emailFrom, to, subject, html });
    if (error) {
      // Never let an email provider outage block registration/login — log and fall through;
      // the OTP is still valid (already saved before this runs) and the user can use "Resend code".
      logger.error(`Failed to send OTP email to ${to} via Resend: ${error.message ?? JSON.stringify(error)}`);
      return;
    }
    logger.info(`OTP email sent to ${to} (id: ${data?.id})`);
  } catch (err) {
    logger.error(`Failed to send OTP email to ${to} via Resend.`, err);
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = 'Reset your ArbitreX password';
  const html = `
    <div style="font-family:sans-serif;max-width:420px;margin:0 auto;">
      <h2 style="color:#0f2a5e;">Reset your password</h2>
      <p>We received a request to reset your ArbitreX password. Click the button below to choose a new one:</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;">Reset Password</a></p>
      <p style="color:#6b7280;font-size:13px;">This link expires in ${env.passwordResetExpiresMinutes} minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="color:#9ca3af;font-size:12px;word-break:break-all;">Or paste this URL into your browser: ${resetUrl}</p>
    </div>`;

  const resend = getClient();
  if (!resend) {
    logger.info(`[DEV EMAIL — no RESEND_API_KEY configured] To: ${to} | Subject: ${subject} | Reset URL: ${resetUrl}`);
    return;
  }

  try {
    const { data, error } = await resend.emails.send({ from: env.emailFrom, to, subject, html });
    if (error) {
      logger.error(`Failed to send password reset email to ${to} via Resend: ${error.message ?? JSON.stringify(error)}`);
      return;
    }
    logger.info(`Password reset email sent to ${to} (id: ${data?.id})`);
  } catch (err) {
    logger.error(`Failed to send password reset email to ${to} via Resend.`, err);
  }
}
