import { Schema, model, Document, Types } from 'mongoose';

export interface IMonthlyPerformance extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  month: string; // 'YYYY-MM', server time
  startingBalance: number;
  currentBalance: number;
  profit: number;
  loss: number; // stored as a positive magnitude
  netProfit: number;
  returnPercentage: number;
  tradeCount: number;
  // Daily trade-pacing state — spec §4/§25 (5-10 trades/day, paced across the day rather than
  // decided independently every scheduler tick, which would cluster or under/over-generate).
  todayDate: string; // 'YYYY-MM-DD'
  todayTradeTarget: number;
  todayTradeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const monthlyPerformanceSchema = new Schema<IMonthlyPerformance>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    month: { type: String, required: true },
    startingBalance: { type: Number, required: true },
    currentBalance: { type: Number, required: true },
    profit: { type: Number, default: 0 },
    loss: { type: Number, default: 0 },
    netProfit: { type: Number, default: 0 },
    returnPercentage: { type: Number, default: 0 },
    tradeCount: { type: Number, default: 0 },
    todayDate: { type: String, required: true },
    todayTradeTarget: { type: Number, default: 0 },
    todayTradeCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

monthlyPerformanceSchema.index({ userId: 1, month: 1 }, { unique: true });

export const MonthlyPerformance = model<IMonthlyPerformance>('MonthlyPerformance', monthlyPerformanceSchema);
