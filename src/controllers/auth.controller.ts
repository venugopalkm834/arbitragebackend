import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import * as authService from '../services/auth.service';
import { toPublicUser } from '../services/auth.service';
import { User } from '../models/User';

export const register = asyncHandler(async (req: Request, res: Response) => {
  
  const result = await authService.registerUser(req.body);
  res.status(201).json({ challengeToken: result.challengeToken, maskedEmail: result.maskedEmail });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { challengeToken, otp } = req.body;
  const { user } = await authService.verifyRegistrationOtp(challengeToken, otp);
  // Deliberately does NOT return session tokens — verifying email doesn't
  // log the user in either; they still go through /login (spec: "after
  // register go to login page").
  res.json({ message: 'Email verified successfully. You can now log in.', user: toPublicUser(user) });
});

export const resendEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const { challengeToken } = req.body;
  const result = await authService.resendRegistrationOtp(challengeToken);
  res.json({ message: 'A new code has been sent.', maskedEmail: result.maskedEmail });
});

/** For an unverified account that lost its original registration challenge token (e.g. closed the tab). */
export const resendEmailVerification = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    const result = await authService.resendEmailVerificationByEmail(email);
    res.json({ challengeToken: result.challengeToken, maskedEmail: result.maskedEmail });
  } catch {
    // Same vague response either way — never leak whether an email is registered/verified.
    res.json({ message: 'If that email needs verification, a new code has been sent.' });
  }
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = await authService.loginUser(email, password);

  if (result.twoFactorRequired) {
    res.json({ twoFactorRequired: true, challengeToken: result.challengeToken, maskedEmail: result.maskedEmail });
    return;
  }
  res.json({ twoFactorRequired: false, user: toPublicUser(result.user), ...result.tokens });
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { challengeToken, otp } = req.body;
  const { user, tokens } = await authService.verifyLoginOtp(challengeToken, otp);
  res.json({ user: toPublicUser(user), ...tokens });
});

export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { challengeToken } = req.body;
  const result = await authService.resendLoginOtp(challengeToken);
  res.json({ message: 'A new code has been sent.', maskedEmail: result.maskedEmail });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const { user, tokens } = await authService.refreshTokens(refreshToken);
  res.json({ user: toPublicUser(user), ...tokens });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // Stateless JWTs: logout is client-driven (discard tokens). If the
  // caller wants to invalidate ALL outstanding sessions (e.g. "log out
  // everywhere"), that's revokeAllSessions, wired to change-password.
  res.status(204).send();
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  // Always the same response whether or not the account exists — don't
  // leak which emails are registered. The actual email-or-not branching
  // happens inside the service, not here.
  await authService.requestPasswordReset(email);
  res.json({ message: `If an account exists for ${email}, a reset link has been sent.` });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  await authService.resetPassword(token, newPassword);
  res.json({ message: 'Your password has been reset. You can now log in with your new password.' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const user = await User.findById(req.user.id);
  if (!user) throw ApiError.notFound('User not found.');
  res.json(toPublicUser(user));
});
