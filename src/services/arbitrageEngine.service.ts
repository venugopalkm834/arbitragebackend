import mongoose, { ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { BotConfig, IBotConfig } from '../models/BotConfig';
import { ArbitrageOpportunityConfig } from '../models/ArbitrageOpportunityConfig';
import { BotSession, IBotSession } from '../models/BotSession';
import { Trade, ITrade, CloseReason } from '../models/Trade';
import { Wallet } from '../models/Wallet';
import { Counter } from '../models/Counter';
import { applyLedgerEntry, releaseLocked } from './walletLedger.service';
import { pushNotification } from './notification.service';
import { wsHub } from '../websocket/hub';

const BASE_PRICES: Record<string, number> = {
  'BTC/USDT': 104250, 'ETH/USDT': 3820, 'SOL/USDT': 178.4, 'XRP/USDT': 2.31,
  'BNB/USDT': 692.5, 'ADA/USDT': 0.87, 'DOGE/USDT': 0.194
};

const DEFAULT_PAIRS = Object.keys(BASE_PRICES);

const TICKET_SEQUENCE_NAME = 'trade_ticket';
const TICKET_SEQUENCE_START = 10021;

/**
 * Atomically allocates the next trade ticket number from the DB-backed
 * Counter collection (see models/Counter.ts). This replaced an in-memory
 * `let ticketCounter = 10021` that reset on every server restart — once
 * any trade past TRD-10021 existed, the next restart would immediately
 * try to reuse an already-used ticket and crash trade creation with a
 * Mongo duplicate-key error on Trade.ticket (which is `unique: true`).
 */
export async function getNextTicketNumber(session: ClientSession): Promise<number> {
  const updated = await Counter.findOneAndUpdate(
    { name: TICKET_SEQUENCE_NAME },
    { $inc: { value: 1 } },
    { new: true, session }
  );
  if (updated) return updated.value;

  // First run ever: seed the counter above any hardcoded legacy tickets
  // (e.g. the seed script's fixed 'TRD-10001') and above the old default.
  try {
    const [created] = await Counter.create([{ name: TICKET_SEQUENCE_NAME, value: TICKET_SEQUENCE_START }], { session });
    return created.value;
  } catch (err) {
    // Lost the race against a concurrent first call — retry the atomic increment.
    const retried = await Counter.findOneAndUpdate(
      { name: TICKET_SEQUENCE_NAME },
      { $inc: { value: 1 } },
      { new: true, session }
    );
    if (!retried) throw err;
    return retried.value;
  }
}

/**
 * arbitrage-engine.service.ts
 * -----------------------------
 * The server-authoritative counterpart to the frontend's trade views —
 * Angular NEVER computes P&L or balances; it only displays what this
 * engine publishes over Socket.IO and REST.
 *
 * IMPORTANT: there is no automatic/random simulation here anymore. A
 * trade started via startTrade() simply sits ACTIVE (shown to the user
 * as "running", with no live P&L) until an admin manually settles it as
 * TAKE_PROFIT or STOP_LOSS via settleTrade(). The resulting P&L is
 * computed directly from the trade's OWN takeProfitPct / stopLossPct
 * against its investmentAmount — the admin is choosing which outcome
 * occurred, not an arbitrary number. This replaces the previous
 * per-tick random-walk engine and the "daily admin-controlled P&L bias"
 * feature, which is now redundant with this direct control.
 */

export async function getBotConfig(): Promise<IBotConfig> {
  const existing = await BotConfig.findOne({ singleton: 'GLOBAL' });
  if (existing) return existing;
  return BotConfig.create({ singleton: 'GLOBAL' });
}

export async function getMarketOpportunities() {
  const configs = await ArbitrageOpportunityConfig.find({ enabled: true });
  const source = configs.length > 0 ? configs : DEFAULT_PAIRS.map((pair) => ({
    pair, exchangeA: 'Exchange A Simulator', exchangeB: 'Exchange B Simulator',
    minSpreadPct: 0.2, maxSpreadPct: 1.5, tradingFeePct: 0.1
  }));

  return source.map((cfg) => generateOpportunity(cfg.pair, cfg.exchangeA, cfg.exchangeB, cfg.tradingFeePct));
}

function generateOpportunity(pair: string, buyExchange: string, sellExchange: string, feePct: number) {
  const base = BASE_PRICES[pair] ?? 100;
  const buyPrice = round(base * (1 + Math.random() * 0.001), pair);
  const grossSpreadPct = round2(0.15 + Math.random() * 0.4);
  const sellPrice = round(buyPrice * (1 + grossSpreadPct / 100), pair);
  const netSpreadPct = round2(grossSpreadPct - feePct);
  return { pair, buyExchange, sellExchange, buyPrice, sellPrice, grossSpreadPct, feePct, netSpreadPct };
}

export interface StartTradeInput {
  investmentAmount: number;
  stopLossPct: number;
  takeProfitPct: number;
}

export async function startTrade(userId: string, input: StartTradeInput): Promise<IBotSession> {
  const config = await getBotConfig();

  if (input.investmentAmount < config.minInvestment || input.investmentAmount > config.maxInvestment) {
    throw ApiError.badRequest(`Investment must be between $${config.minInvestment} and $${config.maxInvestment}.`);
  }
  if (input.stopLossPct < config.minStopLoss || input.stopLossPct > config.maxStopLoss) {
    throw ApiError.badRequest(`Stop loss must be between ${config.minStopLoss}% and ${config.maxStopLoss}%.`);
  }
  if (input.takeProfitPct < config.minTakeProfit || input.takeProfitPct > config.maxTakeProfit) {
    throw ApiError.badRequest(`Take profit must be between ${config.minTakeProfit}% and ${config.maxTakeProfit}%.`);
  }

  const activeCount = await BotSession.countDocuments({ userId, status: 'ACTIVE' });
  if (activeCount >= config.maxActiveBotsPerUser) {
    throw ApiError.badRequest(`Maximum of ${config.maxActiveBotsPerUser} active bots per user reached.`);
  }

  const wallet = await Wallet.findOne({ userId });
  if (!wallet) throw ApiError.notFound('Wallet not found.');
  if (wallet.availableBalance < input.investmentAmount) {
    throw ApiError.badRequest('Insufficient available balance for this investment amount.');
  }

  const session = await mongoose.startSession();
  let botSession: IBotSession;
  try {
    session.startTransaction();

    // lock the investment via a proper ledger-safe mutation
    await applyLedgerEntry(
      {
        userId,
        type: 'TRADE_INVESTMENT',
        amount: input.investmentAmount,
        description: 'Arbitrage bot investment locked',
        createdBy: userId
      },
      session
    );

    // Create the bot session only — individual simulated trades are now
    // generated continuously by botScheduler.service.ts for as long as
    // this session stays ACTIVE (spec §2-5), not a single trade here.
    const [created] = await BotSession.create(
      [{ userId, investmentAmount: input.investmentAmount, stopLossPct: input.stopLossPct, takeProfitPct: input.takeProfitPct, status: 'ACTIVE' }],
      { session }
    );
    botSession = created;

    await session.commitTransaction();

    await pushNotification(userId, 'TRADE_STARTED', `Simulated arbitrage bot started — $${input.investmentAmount.toFixed(2)} invested.`);
    wsHub.emitToUser(userId, 'bot:updated', { sessionId: botSession._id.toString(), status: 'ACTIVE', reason: 'STARTED' });
    emitWalletUpdate(userId).catch((err) => logger.error('emitWalletUpdate failed', err));

    return botSession;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/** User-initiated stop of their own running bot session. Any trade generated in the last few seconds
 *  before this simply settles on its own timer — this only stops the scheduler from creating new ones
 *  and returns the (still-locked) investment amount to available balance. */
export async function stopBotSession(userId: string, sessionId: string): Promise<IBotSession> {
  const botSession = await BotSession.findOne({ _id: sessionId, userId });
  if (!botSession) throw ApiError.notFound('Bot session not found.');
  if (botSession.status !== 'ACTIVE') throw ApiError.badRequest('Bot session is not active.');

  botSession.status = 'STOPPED';
  botSession.stoppedAt = new Date();
  await botSession.save();

  await releaseLocked(userId, botSession.investmentAmount);
  await emitWalletUpdate(userId);

  await pushNotification(userId, 'TRADE_STARTED', `Arbitrage bot stopped. Your $${botSession.investmentAmount.toFixed(2)} investment has been returned to your available balance.`);
  wsHub.emitToUser(userId, 'bot:updated', { sessionId: botSession._id.toString(), status: 'STOPPED', reason: 'MANUAL' });

  return botSession;
}

/** The user's current ACTIVE bot session, if any — lets a freshly-loaded page restore bot status without needing a specific id. */
export async function getActiveBotSession(userId: string): Promise<IBotSession | null> {
  return BotSession.findOne({ userId, status: 'ACTIVE' }).sort({ startedAt: -1 });
}

export function serializeBotSession(s: IBotSession) {
  return {
    id: s._id.toString(),
    investmentAmount: s.investmentAmount,
    stopLossPct: s.stopLossPct,
    takeProfitPct: s.takeProfitPct,
    status: s.status,
    startedAt: s.startedAt,
    stoppedAt: s.stoppedAt
  };
}

/**
 * Admin settles an ACTIVE trade as TAKE_PROFIT or STOP_LOSS — a manual
 * override for a specific trade, independent of botScheduler.service.ts's
 * own automatic settlement (used only for edge cases; normal simulated
 * trades settle themselves a few seconds after being created).
 */
export async function settleTrade(tradeId: string, outcome: Extract<CloseReason, 'TAKE_PROFIT' | 'STOP_LOSS'>): Promise<ITrade> {
  const trade = await Trade.findById(tradeId);
  if (!trade) throw ApiError.notFound('Trade not found.');
  if (trade.status !== 'ACTIVE') throw ApiError.badRequest('Trade is not active.');
  return closeTrade(tradeId, outcome);
}

async function closeTrade(tradeId: string, reason: Exclude<CloseReason, null>): Promise<ITrade> {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const trade = await Trade.findById(tradeId).session(session);
    if (!trade) throw ApiError.notFound('Trade not found.');

    // Compute the outcome P&L directly from the trade's own TP/SL percentages.
    // MANUAL (user cancel) always nets $0 — no partial simulated movement exists anymore.
    let profitLoss = 0;
    let profitLossPct = 0;
    if (reason === 'TAKE_PROFIT') {
      profitLossPct = trade.takeProfitPct;
      profitLoss = round2((trade.investmentAmount * trade.takeProfitPct) / 100);
    } else if (reason === 'STOP_LOSS') {
      profitLossPct = -trade.stopLossPct;
      profitLoss = round2(-(trade.investmentAmount * trade.stopLossPct) / 100);
    }

    trade.profitLoss = profitLoss;
    trade.profitLossPct = profitLossPct;
    trade.currentValue = round2(trade.investmentAmount + profitLoss);
    trade.exitValue = trade.currentValue;
    trade.status = reason === 'STOP_LOSS' ? 'STOP_LOSS' : reason === 'TAKE_PROFIT' ? 'TAKE_PROFIT' : 'COMPLETED';
    trade.closeReason = reason;
    trade.closedAt = new Date();
    await trade.save({ session });

    // NOTE: this used to also stop the whole BotSession here — that was
    // correct back when one BotSession had exactly one Trade, but now a
    // session runs many trades over its lifetime (botScheduler.service.ts),
    // so an individual trade closing (e.g. an admin's manual settle) must
    // NOT end the session. Session lifecycle is now handled separately by
    // stopBotSession() (user stop) and maybeEnforceSessionSlTp() (cumulative
    // session SL/TP threshold).

    // NOTE: no releaseLocked() call here anymore — a single trade closing
    // no longer means "the session's investment comes back" (see the note
    // above). The session's investmentAmount stays locked for its whole
    // lifetime and is only released by stopBotSession() or
    // stopSessionOnThreshold() when the session itself ends.

    // apply P&L as its own auditable ledger entry
    if (trade.profitLoss > 0) {
      await applyLedgerEntry(
        {
          userId: trade.userId,
          type: 'TRADE_PROFIT',
          amount: trade.profitLoss,
          referenceId: trade.ticket,
          description: `Profit from ${trade.pair} arbitrage trade (${reason})`,
          createdBy: trade.userId
        },
        session
      );
    } else if (trade.profitLoss < 0) {
      await applyLedgerEntry(
        {
          userId: trade.userId,
          type: 'TRADE_LOSS',
          amount: Math.abs(trade.profitLoss),
          referenceId: trade.ticket,
          description: `Loss from ${trade.pair} arbitrage trade (${reason})`,
          createdBy: trade.userId
        },
        session
      );
    }

    await session.commitTransaction();

    const reasonLabel = reason === 'STOP_LOSS' ? 'Stop loss' : reason === 'TAKE_PROFIT' ? 'Take profit' : 'Cancelled';
    await pushNotification(
      trade.userId,
      reason === 'STOP_LOSS' ? 'STOP_LOSS_TRIGGERED' : reason === 'TAKE_PROFIT' ? 'TAKE_PROFIT_TRIGGERED' : 'TRADE_PROFIT',
      `${reasonLabel}: ${trade.pair} closed with ${trade.profitLoss >= 0 ? '+' : ''}$${trade.profitLoss.toFixed(2)} P&L.`
    );
    wsHub.emitToUser(trade.userId.toString(), 'trade:closed', serializeTrade(trade));
    await emitWalletUpdate(trade.userId.toString());

    return trade;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export async function emitWalletUpdate(userId: string): Promise<void> {
  const wallet = await Wallet.findOne({ userId });
  if (!wallet) return;
  wsHub.emitToUser(userId, 'wallet:update', {
    balance: wallet.balance,
    availableBalance: wallet.availableBalance,
    lockedBalance: wallet.lockedBalance,
    totalProfit: wallet.totalProfit,
    totalLoss: wallet.totalLoss
  });
}

export function serializeTrade(trade: ITrade) {
  return {
    id: trade._id.toString(),
    ticket: trade.ticket,
    pair: trade.pair,
    buyExchange: trade.buyExchange,
    sellExchange: trade.sellExchange,
    investmentAmount: trade.investmentAmount,
    entryValue: trade.entryValue,
    currentValue: trade.currentValue,
    exitValue: trade.exitValue,
    stopLossPct: trade.stopLossPct,
    takeProfitPct: trade.takeProfitPct,
    profitLoss: trade.profitLoss,
    profitLossPct: trade.profitLossPct,
    status: trade.status,
    closeReason: trade.closeReason,
    startedAt: trade.startedAt,
    closedAt: trade.closedAt
  };
}

function round(value: number, pair: string): number {
  const decimals = pair.includes('DOGE') || pair.includes('ADA') || pair.includes('XRP') ? 4 : 2;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
