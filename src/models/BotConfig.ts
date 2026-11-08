import { Schema, model, Document } from 'mongoose';

export interface IBotConfig extends Document {
  singleton: 'GLOBAL'; // enforces exactly one config document
  minInvestment: number;
  maxInvestment: number;
  minStopLoss: number;
  maxStopLoss: number;
  minTakeProfit: number;
  maxTakeProfit: number;
  supportedPairs: string[];
  botFeePct: number;
  tradingFeePct: number;
  /** Max simultaneous ACTIVE bot sessions per user. 0 = unlimited. */
  maxActiveBotsPerUser: number;
  // Controlled simulation parameters (spec: monthly target / daily pacing / per-trade P&L bounds).
  botEnabled: boolean;
  monthlyTargetMinPct: number;
  monthlyTargetMaxPct: number;
  dailyTradeMin: number;
  dailyTradeMax: number;
  minTradeProfitPct: number;
  maxTradeProfitPct: number;
  minTradeLossPct: number; // stored as a positive magnitude, e.g. 0.03 means -0.03%
  maxTradeLossPct: number;
  /** % of a referred user's trade profit credited to their referrer, admin-configurable (referral ask). */
  referralCommissionPct: number;
}

/** Admin-configurable bot parameters — spec §31. Single document, upserted by admins. */
const botConfigSchema = new Schema<IBotConfig>({
  singleton: { type: String, default: 'GLOBAL', unique: true },
  minInvestment: { type: Number, default: 10 },
  maxInvestment: { type: Number, default: 100000 },
  minStopLoss: { type: Number, default: 0.5 },
  maxStopLoss: { type: Number, default: 20 },
  minTakeProfit: { type: Number, default: 0.5 },
  maxTakeProfit: { type: Number, default: 50 },
  supportedPairs: { type: [String], default: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'ADA/USDT', 'DOGE/USDT'] },
  botFeePct: { type: Number, default: 0.1 },
  tradingFeePct: { type: Number, default: 0.1 },
  maxActiveBotsPerUser: { type: Number, default: 5 },
  botEnabled: { type: Boolean, default: true },
  monthlyTargetMinPct: { type: Number, default: 8 },
  monthlyTargetMaxPct: { type: Number, default: 12 },
  dailyTradeMin: { type: Number, default: 8 },
  dailyTradeMax: { type: Number, default: 20 },
  minTradeProfitPct: { type: Number, default: 0.03 },
  maxTradeProfitPct: { type: Number, default: 0.15 },
  minTradeLossPct: { type: Number, default: 0.03 },
  maxTradeLossPct: { type: Number, default: 0.12 },
  referralCommissionPct: { type: Number, default: 10 }
});

export const BotConfig = model<IBotConfig>('BotConfig', botConfigSchema);
