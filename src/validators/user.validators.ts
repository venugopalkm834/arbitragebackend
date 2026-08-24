import { z } from 'zod';

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  mobile: z.string().regex(/^\+?[0-9\s-]{7,15}$/).optional()
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

export const confirmEnable2faSchema = z.object({
  otp: z.string().length(6, 'Enter the 6-digit code')
});

export const disable2faSchema = z.object({
  password: z.string().min(1)
});
