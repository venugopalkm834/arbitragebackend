import { z } from 'zod';

export const walletAdjustmentSchema = z.object({
  type: z.enum(['CREDIT_PROFIT', 'DEBIT_LOSS']),
  amount: z.number().positive('Amount must be greater than 0'),
  reason: z.string().min(1, 'Reason is required'),
  description: z.string().optional().default('')
});

export const userStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BLOCKED', 'PENDING'])
});

export const botConfigSchema = z.object({
  minInvestment: z.number().positive().optional(),
  maxInvestment: z.number().positive().optional(),
  minStopLoss: z.number().positive().optional(),
  maxStopLoss: z.number().positive().optional(),
  minTakeProfit: z.number().positive().optional(),
  maxTakeProfit: z.number().positive().optional(),
  supportedPairs: z.array(z.string()).optional(),
  botFeePct: z.number().min(0).optional(),
  tradingFeePct: z.number().min(0).optional(),
  maxActiveBotsPerUser: z.number().int().positive().optional(),
  // Controlled simulation parameters — spec §2/§11.
  botEnabled: z.boolean().optional(),
  monthlyTargetMinPct: z.number().min(0).optional(),
  monthlyTargetMaxPct: z.number().min(0).optional(),
  dailyTradeMin: z.number().int().positive().optional(),
  dailyTradeMax: z.number().int().positive().optional(),
  minTradeProfitPct: z.number().min(0).optional(),
  maxTradeProfitPct: z.number().min(0).optional(),
  minTradeLossPct: z.number().min(0).optional(),
  maxTradeLossPct: z.number().min(0).optional(),
  referralCommissionPct: z.number().min(0).max(100).optional()
});

/** Admin manually settles an ACTIVE trade as either its own take-profit or stop-loss outcome. */
export const settleTradeSchema = z.object({
  outcome: z.enum(['TAKE_PROFIT', 'STOP_LOSS'])
});
