import mongoose from 'mongoose';
import { Types } from 'mongoose';
import { BotSession, IBotSession } from '../models/BotSession';
import { BotConfig, IBotConfig } from '../models/BotConfig';
import { MonthlyPerformance, IMonthlyPerformance } from '../models/MonthlyPerformance';
import { Trade, ITrade } from '../models/Trade';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { applyLedgerEntry, releaseLocked } from './walletLedger.service';
import { getNextTicketNumber, emitWalletUpdate, serializeTrade, round2 } from './arbitrageEngine.service';
import { pushNotification } from './notification.service';
import { wsHub } from '../websocket/hub';
import { logger } from '../utils/logger';

/**
 * botScheduler.service.ts
 * ------------------------
 * The backend-owned simulation engine (spec §2-5, §23, §25). While a
 * BotSession is ACTIVE, this generates simulated arbitrage trades on its
 * own schedule — independent of any browser tab being open — targeting
 * the admin-configured monthly return range without ever guaranteeing an
 * exact number or letting a single trade run away to an unrealistic size.
 *
 * Design:
 *  - A single `setInterval` tick queries the DB for every ACTIVE
 *    BotSession, so state lives entirely in MongoDB — if the server
 *    restarts, active sessions are picked back up on the very next tick
 *    with no separate "resume" step needed (spec §23).
 *  - Each user gets a `todayTradeTarget` (randomized once per calendar
 *    day, within admin-configured dailyTradeMin/Max) stored on their
 *    MonthlyPerformance doc, and trade generation is paced across the
 *    rest of the day toward that target rather than decided completely
 *    independently every tick (which would cluster trades early or
 *    under-deliver by end of day).
 *  - Win/loss and trade-size bias adapts to how far current-month return
 *    is from a linear pace toward the configured monthly target range —
 *    behind pace pushes win-rate up, over the target cap pulls it down —
 *    while every individual trade still stays within the configured
 *    minTradeProfitPct/maxTradeProfitPct / minTradeLossPct/maxTradeLossPct
 *    bounds, so no single trade (or the month as a whole) can run away.
 *
 * NOTE: this uses one in-process `setInterval`. If this backend is ever
 * scaled to multiple instances, running this in more than one process
 * would double-generate trades — at that point this should move behind
 * a distributed lock (e.g. a short-TTL Mongo/Redis lock acquired at the
 * top of `tick()`) rather than each instance ticking independently.
 */

const EXCHANGES = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'KuCoin'];
const FALLBACK_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'ADA/USDT', 'DOGE/USDT'];

const TICK_INTERVAL_MS = Number(process.env.BOT_TICK_INTERVAL_MS) || 15000;
/** Brief "opening" window before a simulated trade settles, so the UI can show it as running. */
const TRADE_SETTLE_DELAY_MS = Number(process.env.BOT_TRADE_SETTLE_DELAY_MS) || 3000;

let schedulerHandle: NodeJS.Timeout | null = null;
let ticking = false;

export function startScheduler(): void {
  if (schedulerHandle) return;
  schedulerHandle = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  logger.info(`Bot simulation scheduler started (tick every ${TICK_INTERVAL_MS / 1000}s)`);
}

export function stopScheduler(): void {
  if (schedulerHandle) clearInterval(schedulerHandle);
  schedulerHandle = null;
}

async function tick(): Promise<void> {
  if (ticking) return; // guard against overlap if a previous tick is still settling trades
  ticking = true;
  try {
    const config = await BotConfig.findOne({ singleton: 'GLOBAL' });
    if (!config || !config.botEnabled) return;

    const sessions = await BotSession.find({ status: 'ACTIVE' });
    for (const session of sessions) {
      try {
        await maybeGenerateTrade(session, config);
      } catch (err) {
        logger.error(`Bot scheduler: error processing session ${session._id.toString()}`, err);
      }
    }
  } catch (err) {
    logger.error('Bot scheduler tick failed', err);
  } finally {
    ticking = false;
  }
}

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickTwoDistinct<T>(list: T[]): [T, T] {
  const a = list[Math.floor(Math.random() * list.length)];
  let b = list[Math.floor(Math.random() * list.length)];
  while (b === a && list.length > 1) {
    b = list[Math.floor(Math.random() * list.length)];
  }
  return [a, b];
}

async function getOrCreatePerformance(userId: Types.ObjectId, config: IBotConfig): Promise<IMonthlyPerformance> {
  const month = monthKey();
  const today = todayKey();
  const wallet = await Wallet.findOne({ userId });
  const currentBalance = wallet?.balance ?? 0;

  let perf = await MonthlyPerformance.findOne({ userId, month });
  if (!perf) {
    // New month (or first-ever session) — starting balance is whatever the
    // wallet holds right now; history for prior months stays untouched
    // (spec §24), so old MonthlyPerformance docs are never overwritten.
    perf = await MonthlyPerformance.create({
      userId, month, startingBalance: currentBalance, currentBalance,
      profit: 0, loss: 0, netProfit: 0, returnPercentage: 0, tradeCount: 0,
      todayDate: today, todayTradeTarget: randomInt(config.dailyTradeMin, config.dailyTradeMax), todayTradeCount: 0
    });
  } else if (perf.todayDate !== today) {
    perf.todayDate = today;
    perf.todayTradeTarget = randomInt(config.dailyTradeMin, config.dailyTradeMax);
    perf.todayTradeCount = 0;
    await perf.save();
  }
  return perf;
}

async function maybeGenerateTrade(session: IBotSession, config: IBotConfig): Promise<void> {
  const perf = await getOrCreatePerformance(session.userId, config);
  if (perf.todayTradeCount >= perf.todayTradeTarget) return;

  // Pace remaining trades across the remainder of the day so they don't
  // all fire in the first few ticks after the target is (re)rolled.
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msRemainingToday = Math.max(TICK_INTERVAL_MS, startOfDay + 24 * 60 * 60 * 1000 - now.getTime());
  const ticksRemainingToday = Math.max(1, Math.floor(msRemainingToday / TICK_INTERVAL_MS));
  const tradesRemaining = perf.todayTradeTarget - perf.todayTradeCount;
  // Floor a minimum probability so a session started late in the day (or a
  // short local test run) still produces visible activity soon rather than
  // an almost-zero chance spread across a whole remaining day.
  const probability = Math.min(0.9, Math.max(tradesRemaining / ticksRemainingToday, 0.08));

  if (Math.random() > probability) return;
  await generateTrade(session, config, perf);
}

async function generateTrade(session: IBotSession, config: IBotConfig, perf: IMonthlyPerformance): Promise<void> {
  const pairs = config.supportedPairs.length > 0 ? config.supportedPairs : FALLBACK_PAIRS;
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  const [buyExchange, sellExchange] = pickTwoDistinct(EXCHANGES);
  const investmentAmount = session.investmentAmount;

  // --- controlled P&L bias (spec §3/§25): steer toward the configured
  // monthly target range without ever guaranteeing an exact return. ---
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgress = now.getDate() / daysInMonth;
  const targetMid = (config.monthlyTargetMinPct + config.monthlyTargetMaxPct) / 2;
  const expectedPaceReturn = targetMid * monthProgress;
  const currentReturn = perf.returnPercentage;

  let winProbability = 0.68; // baseline — profitable-skewed but never every trade
  if (currentReturn >= config.monthlyTargetMaxPct) {
    winProbability = 0.25; // hard cap reached — pull back hard, never guarantee unlimited profit
  } else if (currentReturn < expectedPaceReturn - 1) {
    winProbability = 0.8; // behind pace — push a bit harder
  } else if (currentReturn > expectedPaceReturn + 1.5) {
    winProbability = 0.45; // ahead of pace — ease off
  }

  const isWin = Math.random() < winProbability;
  const pct = isWin
    ? randomRange(config.minTradeProfitPct, config.maxTradeProfitPct)
    : -randomRange(config.minTradeLossPct, config.maxTradeLossPct);
  const profitLoss = round2((investmentAmount * pct) / 100);
  const profitLossPct = round2(pct);

  const dbSession = await mongoose.startSession();
  let trade: ITrade;
  try {
    dbSession.startTransaction();
    const ticketNumber = await getNextTicketNumber(dbSession);
    const created = await Trade.create(
      [
        {
          ticket: `TRD-${ticketNumber}`,
          userId: session.userId,
          botSessionId: session._id,
          pair,
          buyExchange,
          sellExchange,
          investmentAmount,
          entryValue: investmentAmount,
          currentValue: investmentAmount,
          stopLossPct: session.stopLossPct,
          takeProfitPct: session.takeProfitPct,
          profitLoss: 0,
          profitLossPct: 0,
          status: 'ACTIVE'
        }
      ],
      { session: dbSession }
    );
    trade = created[0];
    await dbSession.commitTransaction();
  } catch (err) {
    await dbSession.abortTransaction();
    throw err;
  } finally {
    dbSession.endSession();
  }

  wsHub.emitToUser(session.userId.toString(), 'trade:started', serializeTrade(trade));

  setTimeout(() => {
    void settleGeneratedTrade(trade._id.toString(), profitLoss, profitLossPct).catch((err) =>
      logger.error(`Failed to settle simulated trade ${trade._id.toString()}`, err)
    );
  }, TRADE_SETTLE_DELAY_MS);
}

async function settleGeneratedTrade(tradeId: string, profitLoss: number, profitLossPct: number): Promise<void> {
  const dbSession = await mongoose.startSession();
  let settledTrade: ITrade | null = null;
  try {
    dbSession.startTransaction();
    const trade = await Trade.findById(tradeId).session(dbSession);
    if (!trade || trade.status !== 'ACTIVE') {
      await dbSession.abortTransaction();
      return;
    }

    trade.profitLoss = profitLoss;
    trade.profitLossPct = profitLossPct;
    trade.currentValue = round2(trade.investmentAmount + profitLoss);
    trade.exitValue = trade.currentValue;
    trade.status = profitLoss >= 0 ? 'PROFIT' : 'LOSS';
    trade.closeReason = 'SIMULATED';
    trade.closedAt = new Date();
    await trade.save({ session: dbSession });

    if (profitLoss > 0) {
      await applyLedgerEntry(
        {
          userId: trade.userId,
          type: 'TRADE_PROFIT',
          amount: profitLoss,
          referenceId: trade.ticket,
          description: `Simulated arbitrage profit — ${trade.pair} (${trade.buyExchange} \u2192 ${trade.sellExchange})`,
          createdBy: trade.userId
        },
        dbSession
      );
    } else if (profitLoss < 0) {
      await applyLedgerEntry(
        {
          userId: trade.userId,
          type: 'TRADE_LOSS',
          amount: Math.abs(profitLoss),
          referenceId: trade.ticket,
          description: `Simulated arbitrage loss — ${trade.pair} (${trade.buyExchange} \u2192 ${trade.sellExchange})`,
          createdBy: trade.userId
        },
        dbSession
      );
    }

    await dbSession.commitTransaction();
    settledTrade = trade;
  } catch (err) {
    await dbSession.abortTransaction();
    throw err;
  } finally {
    dbSession.endSession();
  }

  if (!settledTrade) return;
  const userId = settledTrade.userId.toString();
  wsHub.emitToUser(userId, 'trade:closed', serializeTrade(settledTrade));
  await emitWalletUpdate(userId);
  await updateMonthlyPerformanceAfterTrade(settledTrade);
  await maybeEnforceSessionSlTp(settledTrade);
  await maybeCreditReferralCommission(settledTrade);
}

/**
 * Referral commission (referral ask) — when a referred user earns a
 * trade profit, their referrer is credited an admin-configurable % of
 * that profit, via the normal ledger (so it's just part of the
 * referrer's balance/availableBalance — withdrawable through the
 * existing withdrawal flow, no separate "referral wallet" needed).
 */
async function maybeCreditReferralCommission(trade: ITrade): Promise<void> {
  if (trade.profitLoss <= 0) return;

  const user = await User.findById(trade.userId);
  if (!user?.referredBy) return;

  const config = await BotConfig.findOne({ singleton: 'GLOBAL' });
  const pct = config?.referralCommissionPct ?? 0;
  if (pct <= 0) return;

  const commission = round2((trade.profitLoss * pct) / 100);
  if (commission <= 0) return;

  await applyLedgerEntry({
    userId: user.referredBy,
    type: 'REFERRAL_COMMISSION',
    amount: commission,
    referenceId: trade.ticket,
    description: `Referral commission — ${pct}% of ${user.fullName}'s trade profit (${trade.pair})`,
    createdBy: user._id
  });

  await emitWalletUpdate(user.referredBy.toString());
}

async function updateMonthlyPerformanceAfterTrade(trade: ITrade): Promise<void> {
  const wallet = await Wallet.findOne({ userId: trade.userId });
  const perf = await MonthlyPerformance.findOne({ userId: trade.userId, month: monthKey() });
  if (!perf || !wallet) return;

  if (trade.profitLoss > 0) perf.profit = round2(perf.profit + trade.profitLoss);
  else if (trade.profitLoss < 0) perf.loss = round2(perf.loss + Math.abs(trade.profitLoss));
  perf.netProfit = round2(perf.profit - perf.loss);
  perf.returnPercentage = perf.startingBalance > 0 ? round2((perf.netProfit / perf.startingBalance) * 100) : 0;
  perf.currentBalance = wallet.balance;
  perf.tradeCount += 1;
  perf.todayTradeCount += 1;
  await perf.save();

  wsHub.emitToUser(trade.userId.toString(), 'performance:update', {
    month: perf.month,
    startingBalance: perf.startingBalance,
    currentBalance: perf.currentBalance,
    profit: perf.profit,
    loss: perf.loss,
    netProfit: perf.netProfit,
    returnPercentage: perf.returnPercentage,
    tradeCount: perf.tradeCount,
    todayTradeCount: perf.todayTradeCount,
    todayTradeTarget: perf.todayTradeTarget
  });
}

/** Enforces the session-level SL/TP the user configured at bot start (spec §15 — backend-enforced, not just client-side). */
async function maybeEnforceSessionSlTp(trade: ITrade): Promise<void> {
  const session = await BotSession.findById(trade.botSessionId);
  if (!session || session.status !== 'ACTIVE') return;

  const agg = await Trade.aggregate([
    { $match: { botSessionId: session._id, status: { $in: ['PROFIT', 'LOSS'] } } },
    { $group: { _id: null, total: { $sum: '$profitLoss' } } }
  ]);
  const cumulativePnl: number = agg[0]?.total ?? 0;
  const cumulativePct = session.investmentAmount > 0 ? (cumulativePnl / session.investmentAmount) * 100 : 0;

  if (cumulativePct <= -session.stopLossPct) {
    await stopSessionOnThreshold(session, 'STOP_LOSS');
  } else if (cumulativePct >= session.takeProfitPct) {
    await stopSessionOnThreshold(session, 'TAKE_PROFIT');
  }
}

async function stopSessionOnThreshold(session: IBotSession, reason: 'STOP_LOSS' | 'TAKE_PROFIT'): Promise<void> {
  session.status = 'STOPPED';
  session.stoppedAt = new Date();
  await session.save();

  await releaseLocked(session.userId, session.investmentAmount);
  await emitWalletUpdate(session.userId.toString());

  await pushNotification(
    session.userId,
    reason === 'STOP_LOSS' ? 'STOP_LOSS_TRIGGERED' : 'TAKE_PROFIT_TRIGGERED',
    reason === 'STOP_LOSS'
      ? `Bot session stopped — cumulative stop-loss of ${session.stopLossPct}% reached. Your investment has been returned to your available balance.`
      : `Bot session stopped — cumulative take-profit of ${session.takeProfitPct}% reached. Your investment has been returned to your available balance.`
  );
  wsHub.emitToUser(session.userId.toString(), 'bot:updated', {
    sessionId: session._id.toString(),
    status: 'STOPPED',
    reason
  });
}
