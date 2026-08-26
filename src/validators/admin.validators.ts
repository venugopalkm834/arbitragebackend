import { z } from 'zod';

export const walletAdjustmentSchema = z.object({
  // Not read by the controller — creditWallet/debitWallet each hardcode
  // the type based on which endpoint was hit (/credit vs /debit), so it's
  // optional here. It was previously required with no default, which
  // silently rejected every real request from the admin panel (which
  // never sent it) with a 400 before it reached the controller at all —
  // that was the actual cause of "add/deduct amount not working."
  type: z.enum(['CREDIT_PROFIT', 'DEBIT_LOSS']).optional(),
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

/** Admin adds a platform receiving address shown to users on the Deposit page. */
export const depositAddressSchema = z.object({
  currency: z.string().trim().min(1, 'Currency is required').max(20),
  // Free text (not a closed enum) so admin can add networks beyond the
  // initial BEP20/ERC20/TRC20 ask without a code change later.
  network: z.string().trim().min(1, 'Network is required').max(30),
  address: z.string().trim().min(1, 'Address is required').max(200)
});
