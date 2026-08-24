import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { toPublicUser, revokeAllSessions, requestEnableTwoFactor, confirmEnableTwoFactor, disableTwoFactor } from '../services/auth.service';
import { verifyPassword, hashPassword } from '../utils/password';
import { User } from '../models/User';

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found.');
  res.json(toPublicUser(user));
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found.');

  if (req.body.fullName !== undefined) user.fullName = req.body.fullName;
  if (req.body.mobile !== undefined) user.mobile = req.body.mobile;
  await user.save();

  res.json(toPublicUser(user));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found.');

  const { currentPassword, newPassword } = req.body;
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw ApiError.badRequest('Current password is incorrect.');

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  // Invalidate every other refresh token — a password change should log
  // out any other active session.
  await revokeAllSessions(user._id.toString());

  res.json({ message: 'Password updated successfully.' });
});

// ---------------- Two-Factor Authentication (spec ask: "2FA if user enables it") ----------------

/** Step 1: send a confirmation OTP to the user's own email. */
export const requestEnable2fa = asyncHandler(async (req: Request, res: Response) => {
  await requestEnableTwoFactor(req.user!.id);
  res.json({ message: 'A verification code has been sent to your email.' });
});

/** Step 2: confirm the OTP, actually enabling 2FA. */
export const confirmEnable2fa = asyncHandler(async (req: Request, res: Response) => {
  await confirmEnableTwoFactor(req.user!.id, req.body.otp);
  const user = await User.findById(req.user!.id);
  res.json(toPublicUser(user!));
});

/** Requires the current password — disabling 2FA weakens the account, so re-auth is required. */
export const disable2fa = asyncHandler(async (req: Request, res: Response) => {
  await disableTwoFactor(req.user!.id, req.body.password);
  const user = await User.findById(req.user!.id);
  res.json(toPublicUser(user!));
});
