import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string; // userId
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

export interface RefreshTokenPayload {
  sub: string;
  tokenVersion: number;
}

export interface TwoFactorChallengePayload {
  sub: string; // userId
  purpose: '2fa-login' | 'email-verify';
}

export interface PasswordResetPayload {
  sub: string; // userId
  purpose: 'password-reset';
  tokenVersion: number; // must match user.passwordResetTokenVersion — bumped on successful reset to invalidate the link
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessExpiresIn as any });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshExpiresIn as any });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenPayload;
}

/** Short-lived token proving "this client just correctly entered the password for user X and is mid-2FA" — nothing more. */
export function signTwoFactorChallenge(userId: string): string {
  return jwt.sign({ sub: userId, purpose: '2fa-login' } satisfies TwoFactorChallengePayload, env.jwtTwoFactorSecret, {
    expiresIn: `${env.twoFactorOtpExpiresMinutes}m`
  });
}

export function verifyTwoFactorChallenge(token: string): TwoFactorChallengePayload {
  const payload = jwt.verify(token, env.jwtTwoFactorSecret) as TwoFactorChallengePayload;
  if (payload.purpose !== '2fa-login') throw new Error('Invalid challenge token purpose.');
  return payload;
}

/** Same mechanism, different purpose — proves "this client just registered as user X and needs to confirm their email". */
export function signEmailVerifyChallenge(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'email-verify' } satisfies TwoFactorChallengePayload, env.jwtTwoFactorSecret, {
    expiresIn: `${env.twoFactorOtpExpiresMinutes}m`
  });
}

export function verifyEmailVerifyChallenge(token: string): TwoFactorChallengePayload {
  const payload = jwt.verify(token, env.jwtTwoFactorSecret) as TwoFactorChallengePayload;
  if (payload.purpose !== 'email-verify') throw new Error('Invalid challenge token purpose.');
  return payload;
}

/** Forgot-password reset link token — same short-lived-challenge mechanism, its own purpose + a version check so it's single-use. */
export function signPasswordResetToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, purpose: 'password-reset', tokenVersion } satisfies PasswordResetPayload, env.jwtTwoFactorSecret, {
    expiresIn: `${env.passwordResetExpiresMinutes}m`
  });
}

export function verifyPasswordResetToken(token: string): PasswordResetPayload {
  const payload = jwt.verify(token, env.jwtTwoFactorSecret) as PasswordResetPayload;
  if (payload.purpose !== 'password-reset') throw new Error('Invalid reset token purpose.');
  return payload;
}
