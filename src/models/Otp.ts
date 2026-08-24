import { Schema, model, Document, Types } from 'mongoose';

export type OtpType = 'REGISTER';

/**
 * Otp — a dedicated collection for one-time codes, separate from the
 * User document (which still holds `twoFactorOtpHash` for login-2FA and
 * enable-2FA, left untouched). Currently only used for the registration
 * email-verification code.
 *
 * The code itself is stored hashed (via utils/otp.ts hashOtp/compareOtp),
 * never in plaintext, even at rest in this collection.
 *
 * `expiresAt` has a TTL index so Mongo automatically deletes expired
 * documents — no separate cleanup job needed.
 */
export interface IOtp extends Document {
  _id: Types.ObjectId;
  email: string;
  otpHash: string;
  type: OtpType;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

const otpSchema = new Schema<IOtp>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    otpHash: { type: String, required: true },
    type: { type: String, enum: ['REGISTER'], required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One active code per (email, type) is the intent — lookups always filter on both.
otpSchema.index({ email: 1, type: 1 });
// TTL: Mongo sweeps the document once expiresAt is in the past.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = model<IOtp>('Otp', otpSchema);
