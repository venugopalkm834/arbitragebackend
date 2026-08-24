import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { MonthlyPerformance } from '../models/MonthlyPerformance';
import { Trade } from '../models/Trade';
import { BotConfig } from '../models/BotConfig';

function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

function serializePerformance(p: InstanceType<typeof MonthlyPerformance>) {
  return {
    month: p.month,
    startingBalance: p.startingBalance,
    currentBalance: p.currentBalance,
    profit: p.profit,
    loss: p.loss,
    netProfit: p.netProfit,
    returnPercentage: p.returnPercentage,
    tradeCount: p.tradeCount,
    todayTradeCount: p.todayTradeCount,
    todayTradeTarget: p.todayTradeTarget
  };
}

/** GET /api/performance/monthly?month=YYYY-MM (defaults to the current month). */
export const getMonthlyPerformance = asyncHandler(async (req: Request, res: Response) => {
  const month = (req.query.month as string) || monthKey();
  const config = await BotConfig.findOne({ singleton: 'GLOBAL' });
  const perf = await MonthlyPerformance.findOne({ userId: req.user!.id, month });

  if (!perf) {
    res.json({
      month, startingBalance: 0, currentBalance: 0, profit: 0, loss: 0, netProfit: 0,
      returnPercentage: 0, tradeCount: 0, todayTradeCount: 0, todayTradeTarget: 0,
      targetMinPct: config?.monthlyTargetMinPct ?? 8, targetMaxPct: config?.monthlyTargetMaxPct ?? 12
    });
    return;
  }

  res.json({
    ...serializePerformance(perf),
    targetMinPct: config?.monthlyTargetMinPct ?? 8,
    targetMaxPct: config?.monthlyTargetMaxPct ?? 12
  });
});

/** GET /api/performance/monthly/history — every past month for this user, most recent first (spec §24). */
export const getMonthlyPerformanceHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await MonthlyPerformance.find({ userId: req.user!.id }).sort({ month: -1 }).limit(24);
  res.json(history.map(serializePerformance));
});

/** GET /api/performance/daily?date=YYYY-MM-DD (defaults to today) — aggregated from Trade docs directly. */
export const getDailyPerformance = asyncHandler(async (req: Request, res: Response) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);

  const trades = await Trade.find({
    userId: req.user!.id,
    closedAt: { $gte: start, $lte: end },
    status: { $in: ['PROFIT', 'LOSS', 'TAKE_PROFIT', 'STOP_LOSS'] }
  }).sort({ closedAt: 1 });

  const profit = trades.filter((t) => t.profitLoss > 0).reduce((s, t) => s + t.profitLoss, 0);
  const loss = trades.filter((t) => t.profitLoss < 0).reduce((s, t) => s + Math.abs(t.profitLoss), 0);

  res.json({
    date: dateStr,
    tradeCount: trades.length,
    profit: Math.round(profit * 100) / 100,
    loss: Math.round(loss * 100) / 100,
    netProfit: Math.round((profit - loss) * 100) / 100,
    trades: trades.map((t) => ({
      id: t._id.toString(), ticket: t.ticket, pair: t.pair, buyExchange: t.buyExchange, sellExchange: t.sellExchange,
      investmentAmount: t.investmentAmount, profitLoss: t.profitLoss, profitLossPct: t.profitLossPct,
      status: t.status, closedAt: t.closedAt
    }))
  });
});
