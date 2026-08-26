import { Schema, model, Document, Types } from 'mongoose';

/**
 * A platform-owned receiving address shown to users on the Deposit page,
 * e.g. "USDT" / "TRC20" / "TQn9Y2...". Previously these were hardcoded in
 * the frontend (deposit.component.ts DEPOSIT_ADDRESSES) — now admin-managed
 * here, with the frontend fetching them via GET /wallet/deposit-addresses.
 */
export interface IDepositAddress extends Document {
  _id: Types.ObjectId;
  currency: string; // e.g. 'USDT'
  network: string; // e.g. 'BEP20' | 'ERC20' | 'TRC20' — free text so admin can add others later
  address: string;
  /** Soft-disable without deleting history of what address a past deposit referenced. */
  isActive: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const depositAddressSchema = new Schema<IDepositAddress>(
  {
    currency: { type: String, required: true, uppercase: true, trim: true },
    network: { type: String, required: true, uppercase: true, trim: true },
    address: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// One address per currency+network at a time — adding a new one for the
// same pair should replace the old one (delete it first) rather than
// silently having two active addresses users could randomly get shown.
depositAddressSchema.index({ currency: 1, network: 1 }, { unique: true });

export const DepositAddress = model<IDepositAddress>('DepositAddress', depositAddressSchema);
