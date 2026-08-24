import { Schema, model, Document, Types } from 'mongoose';

export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
export type UserStatus = 'ACTIVE' | 'BLOCKED' | 'PENDING';

export interface IUser extends Document {
  _id: Types.ObjectId;
  fullName: string;
  username: string;
  email: string;
  mobile: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  refreshTokenVersion: number; // bumped to invalidate all outstanding refresh tokens (logout-all / password change)
  // 2FA (email OTP) — optional, user-toggled from Profile. When enabled,
  // login requires a second OTP step (see auth.service.ts verifyLoginOtp).
  twoFactorEnabled: boolean;
  twoFactorOtpHash?: string;
  twoFactorOtpExpiresAt?: Date;
  twoFactorOtpAttempts: number; // failed-attempt counter for the CURRENT otp, reset on every new otp issued
  /**
   * Forgot-password reset links are self-contained JWTs (sub + this
   * version number + purpose, see jwt.ts signPasswordResetToken) rather
   * than a stored token hash — no separate reset-token DB field needed.
   * Bumping this version invalidates every outstanding reset link at
   * once: done automatically whenever a reset actually succeeds, so a
   * used (or old, superseded) link can never be replayed.
   */
  passwordResetTokenVersion: number;
  /** This user's own shareable referral code — auto-generated at registration. */
  referralCode: string;
  /** The user (if any) who referred this account — set once at registration from the code they entered. */
  referredBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    mobile: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['USER', 'ADMIN', 'SUPER_ADMIN'], default: 'USER' },
    status: { type: String, enum: ['ACTIVE', 'BLOCKED', 'PENDING'], default: 'ACTIVE' },
    isEmailVerified: { type: Boolean, default: false },
    refreshTokenVersion: { type: Number, default: 0 },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorOtpHash: { type: String, select: false },
    twoFactorOtpExpiresAt: { type: Date, select: false },
    twoFactorOtpAttempts: { type: Number, default: 0, select: false },
    passwordResetTokenVersion: { type: Number, default: 0 },
    referralCode: { type: String, required: true, unique: true, uppercase: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export const User = model<IUser>('User', userSchema);
