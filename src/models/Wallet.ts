import { Schema, model, Document, Types } from 'mongoose';

export interface IWallet extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  currency: string;
  balance: number;
  availableBalance: number;
  lockedBalance: number;
  totalProfit: number;
  totalLoss: number;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    currency: { type: String, default: 'USDT' },
    balance: { type: Number, default: 0, min: 0 },
    availableBalance: { type: Number, default: 0, min: 0 },
    lockedBalance: { type: Number, default: 0, min: 0 },
    totalProfit: { type: Number, default: 0 },
    totalLoss: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export const Wallet = model<IWallet>('Wallet', walletSchema);
