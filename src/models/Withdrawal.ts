import { Schema, model, Document, Types } from 'mongoose';

export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

export interface IWithdrawal extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  network: string;
  walletAddress: string;
  status: WithdrawalStatus;
  processedBy?: Types.ObjectId;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const withdrawalSchema = new Schema<IWithdrawal>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    fee: { type: Number, required: true, min: 0 },
    netAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    network: { type: String, required: true },
    walletAddress: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'COMPLETED'], default: 'PENDING', index: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date }
  },
  { timestamps: true }
);

export const Withdrawal = model<IWithdrawal>('Withdrawal', withdrawalSchema);
