import { Schema, model, Document, Types } from 'mongoose';

export type AdjustmentType = 'CREDIT_PROFIT' | 'DEBIT_LOSS';

export interface IAdminAdjustment extends Document {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  userId: Types.ObjectId;
  type: AdjustmentType;
  amount: number;
  reason: string;
  description: string;
  createdAt: Date;
}

const adminAdjustmentSchema = new Schema<IAdminAdjustment>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['CREDIT_PROFIT', 'DEBIT_LOSS'], required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    description: { type: String, default: '' }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AdminAdjustment = model<IAdminAdjustment>('AdminAdjustment', adminAdjustmentSchema);
