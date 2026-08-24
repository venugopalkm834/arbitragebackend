import { Schema, model, Document } from 'mongoose';

export interface IArbitrageOpportunityConfig extends Document {
  pair: string;
  exchangeA: string;
  exchangeB: string;
  minSpreadPct: number;
  maxSpreadPct: number;
  tradingFeePct: number;
  enabled: boolean;
}

/** Admin-configurable per-pair settings — spec §30. */
const arbitrageOpportunityConfigSchema = new Schema<IArbitrageOpportunityConfig>({
  pair: { type: String, required: true, unique: true },
  exchangeA: { type: String, required: true, default: 'Exchange A Simulator' },
  exchangeB: { type: String, required: true, default: 'Exchange B Simulator' },
  minSpreadPct: { type: Number, default: 0.2 },
  maxSpreadPct: { type: Number, default: 1.5 },
  tradingFeePct: { type: Number, default: 0.1 },
  enabled: { type: Boolean, default: true }
});

export const ArbitrageOpportunityConfig = model<IArbitrageOpportunityConfig>('ArbitrageOpportunityConfig', arbitrageOpportunityConfigSchema);
