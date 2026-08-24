import { z } from 'zod';

export const startTradeSchema = z.object({
  investmentAmount: z.number().positive('Investment amount must be greater than 0'),
  stopLossPct: z.number().positive('Stop loss must be greater than 0'),
  takeProfitPct: z.number().positive('Take profit must be greater than 0'),
  durationMode: z.enum(['FLEXIBLE', 'FIXED']).optional()
});
