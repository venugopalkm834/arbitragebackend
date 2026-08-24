import { Schema, model, Document, Types } from 'mongoose';

export type TradeStatus =
  | 'PENDING' | 'ACTIVE' | 'PROFIT' | 'LOSS' | 'STOPPED'
  | 'TAKE_PROFIT' | 'STOP_LOSS' | 'COMPLETED' | 'CANCELLED';

export type CloseReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'MANUAL' | 'SIMULATED' | null;

export interface ITrade extends Document {
  _id: Types.ObjectId;
  ticket: string; // e.g. TRD-10245, human-friendly + unique
  userId: Types.ObjectId;
  botSessionId: Types.ObjectId;
  pair: string;
  buyExchange: string;
  sellExchange: string;
  investmentAmount: number;
  entryValue: number;
  currentValue: number;
  exitValue?: number;
  stopLossPct: number;
  takeProfitPct: number;
  profitLoss: number;
  profitLossPct: number;
  status: TradeStatus;
  closeReason: CloseReason;
  startedAt: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const tradeSchema = new Schema<ITrade>(
  {
    ticket: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    botSessionId: { type: Schema.Types.ObjectId, ref: 'BotSession', required: true },
    pair: { type: String, required: true },
    buyExchange: { type: String, required: true },
    sellExchange: { type: String, required: true },
    investmentAmount: { type: Number, required: true, min: 0 },
    entryValue: { type: Number, required: true },
    currentValue: { type: Number, required: true },
    exitValue: { type: Number },
    stopLossPct: { type: Number, required: true },
    takeProfitPct: { type: Number, required: true },
    profitLoss: { type: Number, default: 0 },
    profitLossPct: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'PROFIT', 'LOSS', 'STOPPED', 'TAKE_PROFIT', 'STOP_LOSS', 'COMPLETED', 'CANCELLED'],
      default: 'ACTIVE',
      index: true
    },
    closeReason: { type: String, enum: ['TAKE_PROFIT', 'STOP_LOSS', 'MANUAL', 'SIMULATED', null], default: null },
    startedAt: { type: Date, default: Date.now },
    closedAt: { type: Date }
  },
  { timestamps: true }
);

export const Trade = model<ITrade>('Trade', tradeSchema);
