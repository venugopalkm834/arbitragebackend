import mongoose from 'mongoose';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { hashPassword, verifyPassword } from '../utils/password';
import {
  signAccessToken,
  signRefreshToken,
  signTwoFactorChallenge,
  verifyRefreshToken,
  verifyTwoFactorChallenge,
  signEmailVerifyChallenge,
  verifyEmailVerifyChallenge,
  signPasswordResetToken,
  verifyPasswordResetToken
} from '../utils/jwt';
import { generateOtp, hashOtp, compareOtp, MAX_OTP_ATTEMPTS } from '../utils/otp';
import { sendOtpEmail, sendPasswordResetEmail } from '../utils/email';
import { generateUniqueReferralCode } from '../utils/referral';
import { IUser, User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { WalletTransaction } from '../models/WalletTransaction';
import { Otp } from '../models/Otp';

export interface RegisterInput {
  fullName: string;
  username: string;
  email: string;
  mobile: string;
  password: string;
  referralCode?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Converts a jsonwebtoken-style `expiresIn` value ("15m", "7d", "3600", 900)
 * into whole seconds, so the number we report to the client always matches
 * what was actually signed into the access token — previously this was a
 * hardcoded `15 * 60`, which silently drifted from JWT_ACCESS_EXPIRES_IN
 * whenever that env var was changed from its default.
 */
function toSeconds(expiresIn: string | number): number {
  if (typeof expiresIn === 'number') return expiresIn;
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(expiresIn.trim());
  if (!match) return 15 * 60; // fallback if someone sets an exotic value we can't parse
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit as 's' | 'm' | 'h' | 'd'];
  return value * multiplier;
}

function issueTokens(user: IUser): AuthTokens {
  const accessToken = signAccessToken({ sub: user._id.toString(), role: user.role });
  const refreshToken = signRefreshToken({ sub: user._id.toString(), tokenVersion: user.refreshTokenVersion });
  return { accessToken, refreshToken, expiresIn: toSeconds(env.jwtAccessExpiresIn) };
}

export function toPublicUser(user: IUser) {
  // Never send passwordHash or OTP fields to the frontend (spec §41).
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    referralCode: user.referralCode,
    createdAt: user.createdAt
  };
}

/** Registration creates the User AND their Wallet (seeded with the demo starting balance, itself an auditable ledger entry) atomically. */
export interface RegisterResult {
  user: IUser;
  challengeToken: string;
  maskedEmail: string;
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const existingEmail = await User.findOne({ email: input.email.toLowerCase() });
  if (existingEmail) throw ApiError.conflict('An account with this email already exists.');

  const existingUsername = await User.findOne({ username: input.username.toLowerCase() });
  if (existingUsername) throw ApiError.conflict('This username is already taken.');

  // Referral code is optional, but if one was entered it must resolve to a real referrer (referral ask).
  let referrer: IUser | null = null;
  if (input.referralCode) {
    referrer = await User.findOne({ referralCode: input.referralCode.trim().toUpperCase() });
    if (!referrer) throw ApiError.badRequest('That referral code does not exist.');
  }

  const passwordHash = await hashPassword(input.password);
  const ownReferralCode = await generateUniqueReferralCode();

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const [user] = await User.create(
      [
        {
          fullName: input.fullName,
          username: input.username.toLowerCase(),
          email: input.email.toLowerCase(),
          mobile: input.mobile,
          passwordHash,
          role: 'USER',
          status: 'ACTIVE',
          isEmailVerified: false,
          referralCode: ownReferralCode,
          referredBy: referrer?._id
        }
      ],
      { session }
    );

    const [wallet] = await Wallet.create(
      [
        {
          userId: user._id,
          currency: 'USDT',
          balance: env.demoStartingBalance,
          availableBalance: env.demoStartingBalance,
          lockedBalance: 0
        }
      ],
      { session }
    );

    await WalletTransaction.create(
      [
        {
          userId: user._id,
          walletId: wallet._id,
          type: 'DEPOSIT',
          amount: env.demoStartingBalance,
          balanceBefore: 0,
          balanceAfter: env.demoStartingBalance,
          description: 'Initial demo account balance',
          createdBy: user._id
        }
      ],
      { session }
    );

    await session.commitTransaction();

    // Registration no longer issues session tokens — email must be
    // verified first (OTP), and even after that the user goes to /login
    // rather than being auto-authenticated (spec: "after register go to
    // login page").
    await issueAndSendRegisterOtp(user);
    return { user, challengeToken: signEmailVerifyChallenge(user._id.toString()), maskedEmail: maskEmail(user.email) };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/** Confirms the OTP sent at registration and marks the account's email as verified. Does NOT log the user in. */
export async function verifyRegistrationOtp(challengeToken: string, otp: string): Promise<{ user: IUser }> {
  let userId: string;
  try {
    userId = verifyEmailVerifyChallenge(challengeToken).sub;
  } catch {
    throw ApiError.unauthorized('This verification session has expired. Please register again or request a new code from the login page.');
  }
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists.');
  await consumeRegisterOtp(user.email, otp);
  user.isEmailVerified = true;
  await user.save();
  return { user };
}

export async function resendRegistrationOtp(challengeToken: string): Promise<{ maskedEmail: string }> {
  let userId: string;
  try {
    userId = verifyEmailVerifyChallenge(challengeToken).sub;
  } catch {
    throw ApiError.unauthorized('This verification session has expired. Please register again.');
  }
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists.');
  await issueAndSendRegisterOtp(user);
  return { maskedEmail: maskEmail(user.email) };
}

/**
 * A registered-but-unverified account can also (re)request a fresh email
 * OTP from the login screen — e.g. they closed the tab before finishing
 * the original registration flow, or the code expired.
 */
export async function resendEmailVerificationByEmail(email: string): Promise<{ challengeToken: string; maskedEmail: string }> {
  const user = await User.findOne({ email: email.toLowerCase() });
  // Deliberately vague error either way — don't leak whether an email is registered.
  if (!user || user.isEmailVerified) {
    throw ApiError.badRequest('If that email needs verification, a new code has been sent.');
  }
  await issueAndSendRegisterOtp(user);
  return { challengeToken: signEmailVerifyChallenge(user._id.toString()), maskedEmail: maskEmail(user.email) };
}

export type LoginResult =
  | { twoFactorRequired: false; user: IUser; tokens: AuthTokens }
  | { twoFactorRequired: true; challengeToken: string; maskedEmail: string };

/** Masks an email for display during the 2FA step, e.g. "j***n@example.com" — never echo the full address back. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return `${local[0] ?? '*'}***@${domain ?? ''}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export async function loginUser(email: string, password: string): Promise<LoginResult> {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Invalid email or password.');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password.');

  if (user.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked.');

  if (!user.isEmailVerified) {
    throw ApiError.badRequest('Please verify your email before logging in.', { requiresEmailVerification: true, email: user.email });
  }

  if (!user.twoFactorEnabled) {
    return { twoFactorRequired: false, user, tokens: issueTokens(user) };
  }

  // 2FA enabled — password alone isn't enough. Issue a fresh OTP and a
  // short-lived challenge token; the real session tokens aren't issued
  // until verifyLoginOtp() succeeds.
  await issueAndSendOtp(user);
  return { twoFactorRequired: true, challengeToken: signTwoFactorChallenge(user._id.toString()), maskedEmail: maskEmail(user.email) };
}

async function issueAndSendOtp(user: IUser): Promise<void> {
  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  await User.updateOne(
    { _id: user._id },
    {
      twoFactorOtpHash: otpHash,
      twoFactorOtpExpiresAt: new Date(Date.now() + env.twoFactorOtpExpiresMinutes * 60 * 1000),
      twoFactorOtpAttempts: 0
    }
  );
  await sendOtpEmail(user.email, otp);
}

/**
 * Registration-verification OTP — stored in its own `Otp` collection
 * (type: 'REGISTER'), not on the User document. Any previous unexpired
 * code for this email+type is discarded first so only the latest one
 * is ever valid (mirrors the `Otp.deleteMany` + `Otp.create` pattern).
 */
async function issueAndSendRegisterOtp(user: IUser): Promise<void> {
  const otp = generateOtp();
  const otpHash = await hashOtp(otp);

  await Otp.deleteMany({ email: user.email, type: 'REGISTER' });
  await Otp.create({
    email: user.email,
    otpHash,
    type: 'REGISTER',
    expiresAt: new Date(Date.now() + env.twoFactorOtpExpiresMinutes * 60 * 1000)
  });

  await sendOtpEmail(user.email, otp);
}

/** Verifies + single-uses the registration OTP stored in the `Otp` collection. */
async function consumeRegisterOtp(email: string, otp: string): Promise<void> {
  const record = await Otp.findOne({ email: email.toLowerCase(), type: 'REGISTER' }).sort({ createdAt: -1 });
  if (!record) {
    throw ApiError.badRequest('No verification code is pending for this account. Please request a new one.');
  }
  if (record.expiresAt.getTime() < Date.now()) {
    await record.deleteOne();
    throw ApiError.badRequest('This code has expired. Please request a new one.');
  }
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await record.deleteOne();
    throw ApiError.badRequest('Too many incorrect attempts. Please request a new code.');
  }

  const valid = await compareOtp(otp, record.otpHash);
  if (!valid) {
    await Otp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    throw ApiError.unauthorized('Incorrect code. Please try again.');
  }

  // Single-use — remove it immediately on success.
  await record.deleteOne();
}

/** Shared OTP-check-and-consume logic (verify + single-use + attempt-limit), used by both the registration-email-verify and enable-2FA-confirm flows. */
async function consumeOtp(userId: string, otp: string): Promise<void> {
  const user = await User.findById(userId).select('+twoFactorOtpHash +twoFactorOtpExpiresAt +twoFactorOtpAttempts');
  if (!user) throw ApiError.unauthorized('Account no longer exists.');
  if (!user.twoFactorOtpHash || !user.twoFactorOtpExpiresAt) {
    throw ApiError.badRequest('No verification code is pending for this account. Please request a new one.');
  }
  if (user.twoFactorOtpExpiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('This code has expired. Please request a new one.');
  }
  if (user.twoFactorOtpAttempts >= MAX_OTP_ATTEMPTS) {
    throw ApiError.badRequest('Too many incorrect attempts. Please request a new code.');
  }
  const valid = await compareOtp(otp, user.twoFactorOtpHash);
  if (!valid) {
    await User.updateOne({ _id: user._id }, { $inc: { twoFactorOtpAttempts: 1 } });
    throw ApiError.unauthorized('Incorrect code. Please try again.');
  }
  await User.updateOne({ _id: user._id }, { $set: { twoFactorOtpAttempts: 0 }, $unset: { twoFactorOtpHash: '', twoFactorOtpExpiresAt: '' } });
}

/** Completes a 2FA login: verifies the OTP against the challenge token's user, then issues real session tokens. */
export async function verifyLoginOtp(challengeToken: string, otp: string): Promise<{ user: IUser; tokens: AuthTokens }> {
  let userId: string;
  try {
    userId = verifyTwoFactorChallenge(challengeToken).sub;
  } catch {
    throw ApiError.unauthorized('This verification session has expired. Please log in again.');
  }

  const user = await User.findById(userId).select('+twoFactorOtpHash +twoFactorOtpExpiresAt +twoFactorOtpAttempts');
  if (!user) throw ApiError.unauthorized('Account no longer exists.');
  if (!user.twoFactorOtpHash || !user.twoFactorOtpExpiresAt) {
    throw ApiError.badRequest('No verification code is pending for this account. Please log in again.');
  }
  if (user.twoFactorOtpExpiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('This code has expired. Please request a new one.');
  }
  if (user.twoFactorOtpAttempts >= MAX_OTP_ATTEMPTS) {
    throw ApiError.badRequest('Too many incorrect attempts. Please request a new code.');
  }

  const valid = await compareOtp(otp, user.twoFactorOtpHash);
  if (!valid) {
    await User.updateOne({ _id: user._id }, { $inc: { twoFactorOtpAttempts: 1 } });
    throw ApiError.unauthorized('Incorrect code. Please try again.');
  }

  // Single-use — clear it immediately on success.
  await User.updateOne({ _id: user._id }, { $set: { twoFactorOtpAttempts: 0 }, $unset: { twoFactorOtpHash: '', twoFactorOtpExpiresAt: '' } });

  return { user, tokens: issueTokens(user) };
}

/** Resends a fresh OTP for an in-progress 2FA challenge (invalidates the previous code). */
export async function resendLoginOtp(challengeToken: string): Promise<{ maskedEmail: string }> {
  let userId: string;
  try {
    userId = verifyTwoFactorChallenge(challengeToken).sub;
  } catch {
    throw ApiError.unauthorized('This verification session has expired. Please log in again.');
  }
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists.');
  await issueAndSendOtp(user);
  return { maskedEmail: maskEmail(user.email) };
}

// ---------------- 2FA enable / disable (Profile settings) ----------------

/** Step 1 of enabling 2FA: send a confirmation OTP to the user's own email (proves the address is reachable). */
export async function requestEnableTwoFactor(userId: string): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found.');
  if (user.twoFactorEnabled) throw ApiError.badRequest('Two-factor authentication is already enabled.');
  await issueAndSendOtp(user);
}

/** Step 2: confirm the OTP just sent, then actually flip twoFactorEnabled on. */
export async function confirmEnableTwoFactor(userId: string, otp: string): Promise<void> {
  const user = await User.findById(userId).select('+twoFactorOtpHash +twoFactorOtpExpiresAt +twoFactorOtpAttempts');
  if (!user) throw ApiError.notFound('User not found.');
  if (!user.twoFactorOtpHash || !user.twoFactorOtpExpiresAt || user.twoFactorOtpExpiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('This code has expired. Please request a new one.');
  }
  if (user.twoFactorOtpAttempts >= MAX_OTP_ATTEMPTS) {
    throw ApiError.badRequest('Too many incorrect attempts. Please request a new code.');
  }
  const valid = await compareOtp(otp, user.twoFactorOtpHash);
  if (!valid) {
    await User.updateOne({ _id: user._id }, { $inc: { twoFactorOtpAttempts: 1 } });
    throw ApiError.unauthorized('Incorrect code. Please try again.');
  }
  await User.updateOne(
    { _id: user._id },
    { $set: { twoFactorEnabled: true, twoFactorOtpAttempts: 0 }, $unset: { twoFactorOtpHash: '', twoFactorOtpExpiresAt: '' } }
  );
}

/** Disabling requires the current password (not just being logged in) — standard practice for weakening account security. */
export async function disableTwoFactor(userId: string, password: string): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found.');
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Incorrect password.');
  await User.updateOne({ _id: user._id }, { $set: { twoFactorEnabled: false, twoFactorOtpAttempts: 0 }, $unset: { twoFactorOtpHash: '', twoFactorOtpExpiresAt: '' } });
}

export async function refreshTokens(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token.');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists.');
  if (user.status === 'BLOCKED') throw ApiError.forbidden('This account has been blocked.');

  // If refreshTokenVersion has been bumped since this token was issued
  // (logout-all, password change), the old refresh token is dead.
  if (payload.tokenVersion !== user.refreshTokenVersion) {
    throw ApiError.unauthorized('Refresh token has been revoked.');
  }

  return { user, tokens: issueTokens(user) };
}

/** Bumps refreshTokenVersion, invalidating every outstanding refresh token for this user. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $inc: { refreshTokenVersion: 1 } });
}

// ---------------- Forgot / reset password ----------------

/**
 * Step 1 of "forgot password": if the email matches an account, email a
 * reset link. Always resolves the same way either way (nothing thrown,
 * nothing returned that differs) — the controller's response text is
 * identical whether or not the account exists, so this never leaks which
 * emails are registered. Blocked accounts can still reset their password
 * (locking someone out of email-based recovery just because their trading
 * account was blocked would be its own support headache); the BLOCKED
 * check still applies at login.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return;

  const token = signPasswordResetToken(user._id.toString(), user.passwordResetTokenVersion);
  const resetUrl = `${env.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendPasswordResetEmail(user.email, resetUrl);
}

/**
 * Step 2: verifies the reset link's token, sets the new password, then
 * invalidates the link (passwordResetTokenVersion++) so it can't be
 * replayed, and invalidates every existing session (refreshTokenVersion++)
 * — standard practice: if a password was just reset, any refresh token
 * issued under the old password should stop working too.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  let payload;
  try {
    payload = verifyPasswordResetToken(token);
  } catch {
    throw ApiError.badRequest('This reset link is invalid or has expired. Please request a new one.');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.badRequest('This reset link is invalid or has expired. Please request a new one.');

  if (payload.tokenVersion !== user.passwordResetTokenVersion) {
    throw ApiError.badRequest('This reset link has already been used or a newer one was requested. Please request a new one.');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordResetTokenVersion += 1;
  user.refreshTokenVersion += 1;
  await user.save();
}
