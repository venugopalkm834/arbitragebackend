import { z } from 'zod';

export const registerSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  username: z.string().min(3, 'Username must be at least 3 characters').regex(/^[a-zA-Z0-9_.]+$/, 'Username can only contain letters, numbers, underscores and periods'),
  email: z.string().email('Enter a valid email address'),
  mobile: z.string().regex(/^\+?[0-9\s-]{7,15}$/, 'Enter a valid mobile number'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  referralCode: z.string().optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to continue.' }) })
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match', path: ['confirmPassword']
});

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional()
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required')
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address')
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

export const verifyOtpSchema = z.object({
  challengeToken: z.string().min(1),
  otp: z.string().length(6, 'Enter the 6-digit code')
});

export const resendOtpSchema = z.object({
  challengeToken: z.string().min(1)
});

export const verifyEmailSchema = z.object({
  challengeToken: z.string().min(1),
  otp: z.string().length(6, 'Enter the 6-digit code')
});

export const resendEmailVerificationSchema = z.object({
  email: z.string().email()
});
