import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as engine from '../services/arbitrageEngine.service';

export const getOpportunities = asyncHandler(async (_req: Request, res: Response) => {
  const opportunities = await engine.getMarketOpportunities();
  res.json(opportunities);
});


/** Alias of POST /trades/start kept for spec §38 API compatibility (`POST /api/arbitrage/start`). */
export const startArbitrage = asyncHandler(async (req: Request, res: Response) => {
  const botSession = await engine.startTrade(req.user!.id, req.body);
  res.status(201).json(engine.serializeBotSession(botSession));
});
