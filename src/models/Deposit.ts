import { Schema, model, Document, Types } from 'mongoose';

export type DepositStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IDeposit extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  currency: string;
  network: string;
  walletAddress: string;
  /** Public URL (e.g. /uploads/receipts/xyz.jpg) of the user-uploaded proof-of-payment, if any. */
  receiptUrl?: string;
  status: DepositStatus;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const depositSchema = new Schema<IDeposit>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    network: { type: String, required: true },
    walletAddress: { type: String, required: true },
    receiptUrl: { type: String },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date }
  },
  { timestamps: true }
);

export const Deposit = model<IDeposit>('Deposit', depositSchema);
