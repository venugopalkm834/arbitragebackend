import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Trade, ITrade } from '../models/Trade';
import * as engine from '../services/arbitrageEngine.service';

export const startTrade = asyncHandler(async (req: Request, res: Response) => {
  const botSession = await engine.startTrade(req.user!.id, req.body);
  res.status(201).json(engine.serializeBotSession(botSession));
});

/** :id here is a bot session id (see startTrade above) — stops the session, not a single trade. */
export const stopTrade = asyncHandler(async (req: Request, res: Response) => {
  const botSession = await engine.stopBotSession(req.user!.id, req.params.id);
  res.json(engine.serializeBotSession(botSession));
});

export const getBotStatus = asyncHandler(async (req: Request, res: Response) => {
  const botSession = await engine.getActiveBotSession(req.user!.id);
  res.json(botSession ? engine.serializeBotSession(botSession) : null);
});

export const listActiveTrades = asyncHandler(async (req: Request, res: Response) => {
  const trades = await Trade.find({ userId: req.user!.id, status: 'ACTIVE' }).sort({ startedAt: -1 });
  res.json(trades.map(serializeTrade));
});

/** Paginated — spec §16: never send unbounded history to the client. */
export const listTradeHistory = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter: Record<string, unknown> = { userId: req.user!.id, status: { $ne: 'ACTIVE' } };

  if (req.query.pair) filter.pair = req.query.pair;
  if (req.query.outcome === 'PROFIT') filter.profitLoss = { $gt: 0 };
  if (req.query.outcome === 'LOSS') filter.profitLoss = { $lt: 0 };
  if (req.query.from || req.query.to) {
    filter.closedAt = {
      ...(req.query.from ? { $gte: new Date(req.query.from as string) } : {}),
      ...(req.query.to ? { $lte: new Date(req.query.to as string) } : {})
    };
  }

  const [trades, total] = await Promise.all([
    Trade.find(filter).sort({ closedAt: -1 }).skip((page - 1) * limit).limit(limit),
    Trade.countDocuments(filter)
  ]);

  res.json({ trades: trades.map(serializeTrade), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

export const getTrade = asyncHandler(async (req: Request, res: Response) => {
  const trade = await Trade.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!trade) throw ApiError.notFound('Trade not found.');
  res.json(serializeTrade(trade));
});

export function serializeTrade(t: ITrade) {
  return {
    id: t._id.toString(), ticket: t.ticket, botSessionId: t.botSessionId.toString(), pair: t.pair,
    buyExchange: t.buyExchange, sellExchange: t.sellExchange,
    investmentAmount: t.investmentAmount, entryValue: t.entryValue, currentValue: t.currentValue, exitValue: t.exitValue,
    stopLossPct: t.stopLossPct, takeProfitPct: t.takeProfitPct, profitLoss: t.profitLoss, profitLossPct: t.profitLossPct,
    status: t.status, closeReason: t.closeReason, startedAt: t.startedAt, closedAt: t.closedAt
  };
}
