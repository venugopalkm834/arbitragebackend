import { Schema, model, Document, Types } from 'mongoose';

export type BotSessionStatus = 'ACTIVE' | 'STOPPED' | 'COMPLETED';

export interface IBotSession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  investmentAmount: number;
  stopLossPct: number;
  takeProfitPct: number;
  status: BotSessionStatus;
  startedAt: Date;
  stoppedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const botSessionSchema = new Schema<IBotSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    investmentAmount: { type: Number, required: true, min: 0 },
    stopLossPct: { type: Number, required: true },
    takeProfitPct: { type: Number, required: true },
    status: { type: String, enum: ['ACTIVE', 'STOPPED', 'COMPLETED'], default: 'ACTIVE' },
    startedAt: { type: Date, default: Date.now },
    stoppedAt: { type: Date }
  },
  { timestamps: true }
);

export const BotSession = model<IBotSession>('BotSession', botSessionSchema);
