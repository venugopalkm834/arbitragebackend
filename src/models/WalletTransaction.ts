import { Schema, model, Document, Types } from 'mongoose';

export type WalletTransactionType =
  | 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_INVESTMENT' | 'TRADE_PROFIT'
  | 'TRADE_LOSS' | 'TRADE_REFUND' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT' | 'FEE'
  | 'REFERRAL_COMMISSION';

export interface IWalletTransaction extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  walletId: Types.ObjectId;
  type: WalletTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  description: string;
  createdBy: Types.ObjectId; // userId or adminId
  createdAt: Date;
}

/**
 * Append-only ledger. Nothing ever updates or deletes a row here — this
 * is the audit trail spec §35/§42 requires: wallet.balance must never
 * change without a corresponding WalletTransaction being written first,
 * in the same DB transaction.
 */
const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true },
    type: {
      type: String,
      enum: ['DEPOSIT', 'WITHDRAWAL', 'TRADE_INVESTMENT', 'TRADE_PROFIT', 'TRADE_LOSS', 'TRADE_REFUND', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'FEE', 'REFERRAL_COMMISSION'],
      required: true
    },
    amount: { type: Number, required: true, min: 0 },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    referenceId: { type: String },
    description: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const WalletTransaction = model<IWalletTransaction>('WalletTransaction', walletTransactionSchema);
