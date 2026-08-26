import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { AuditLog } from '../models/AuditLog';
import { BotConfig } from '../models/BotConfig';
import { BotSession } from '../models/BotSession';
import { ArbitrageOpportunityConfig } from '../models/ArbitrageOpportunityConfig';
import { Deposit } from '../models/Deposit';
import { Trade } from '../models/Trade';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Withdrawal } from '../models/Withdrawal';
import * as adminService from '../services/admin.service';
import * as engine from '../services/arbitrageEngine.service';
import { serializeTrade } from './trade.controller';
import { AuditContext } from '../services/admin.service';
import { DepositAddress } from '../models/depositAddress';

function auditContext(req: Request): AuditContext {
  return {
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    ipAddress: req.ip ?? req.socket.remoteAddress ?? 'unknown'
  };
}

// ---------------- Dashboard (spec §21) ----------------

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const [totalUsers, activeUsers, deposits, withdrawals, wallets, activeBots] = await Promise.all([
    User.countDocuments({ role: 'USER' }),
    User.countDocuments({ role: 'USER', status: 'ACTIVE' }),
    Deposit.find(),
    Withdrawal.find(),
    Wallet.find(),
    Trade.countDocuments({ status: 'ACTIVE' })
  ]);

  const totalDeposits = deposits.filter((d) => d.status === 'APPROVED').reduce((s, d) => s + d.amount, 0);
  const pendingDeposits = deposits.filter((d) => d.status === 'PENDING').length;
  const totalWithdrawals = withdrawals.filter((w) => w.status === 'COMPLETED').reduce((s, w) => s + w.amount, 0);
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'PENDING' || w.status === 'PROCESSING').length;
  const totalProfit = wallets.reduce((s, w) => s + w.totalProfit, 0);
  const totalLoss = wallets.reduce((s, w) => s + w.totalLoss, 0);

  res.json({
    totalUsers, activeUsers, totalDeposits, pendingDeposits, totalWithdrawals, pendingWithdrawals,
    totalTradingVolume: (totalProfit + totalLoss) * 4.2, totalProfit, totalLoss, activeBots
  });
});

// ---------------- Users (spec §23) ----------------

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const search = String(req.query.search ?? '').trim();
  const filter: Record<string, unknown> = { role: 'USER' };
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const users = await User.find(filter).sort({ createdAt: -1 });
  const wallets = await Wallet.find({ userId: { $in: users.map((u) => u._id) } });
  const walletByUser = new Map(wallets.map((w) => [w.userId.toString(), w]));
  const activeBotCounts = await Trade.aggregate([
    { $match: { status: 'ACTIVE', userId: { $in: users.map((u) => u._id) } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } }
  ]);
  const activeBotsByUser = new Map(activeBotCounts.map((c) => [c._id.toString(), c.count]));

  res.json(
    users.map((u) => {
      const wallet = walletByUser.get(u._id.toString());
      return {
        id: u._id.toString(), fullName: u.fullName, email: u.email, mobile: u.mobile,
        balance: wallet?.balance ?? 0, totalProfit: wallet?.totalProfit ?? 0, totalLoss: wallet?.totalLoss ?? 0,
        activeBots: activeBotsByUser.get(u._id.toString()) ?? 0, status: u.status, createdAt: u.createdAt
      };
    })
  );
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');

  const wallet = await Wallet.findOne({ userId: user._id });
  const activeTrades = await Trade.find({ userId: user._id, status: 'ACTIVE' });
  const tradeHistory = await Trade.find({ userId: user._id, status: { $ne: 'ACTIVE' } }).sort({ closedAt: -1 }).limit(50);
  const deposits = await Deposit.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50);
  const withdrawals = await Withdrawal.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50);

  res.json({
    user: { id: user._id.toString(), fullName: user.fullName, username: user.username, email: user.email, mobile: user.mobile, status: user.status, createdAt: user.createdAt },
    wallet: wallet ? { balance: wallet.balance, availableBalance: wallet.availableBalance, lockedBalance: wallet.lockedBalance, totalProfit: wallet.totalProfit, totalLoss: wallet.totalLoss } : null,
    activeTrades: activeTrades.map(serializeTrade),
    tradeHistory: tradeHistory.map(serializeTrade),
    deposits, withdrawals
  });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');

  if (req.body.fullName !== undefined) user.fullName = req.body.fullName;
  if (req.body.mobile !== undefined) user.mobile = req.body.mobile;
  await user.save();

  res.json({ id: user._id.toString(), fullName: user.fullName, email: user.email, mobile: user.mobile, status: user.status });
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminService.setUserStatus(req.params.id, req.body.status, auditContext(req));
  res.json({ id: user._id.toString(), status: user.status });
});

// ---------------- Deposits (spec §26) ----------------

export const listAllDeposits = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const filter = status ? { status } : {};
  const deposits = await Deposit.find(filter).sort({ createdAt: -1 }).populate('userId', 'fullName email');
  res.json(deposits.map(serializeDepositWithUser));
});

export const approveDeposit = asyncHandler(async (req: Request, res: Response) => {
  const deposit = await adminService.approveDeposit(req.params.id, auditContext(req));
  res.json(deposit);
});

export const rejectDeposit = asyncHandler(async (req: Request, res: Response) => {
  const deposit = await adminService.rejectDeposit(req.params.id, auditContext(req));
  res.json(deposit);
});

function serializeDepositWithUser(d: any) {
  return {
    id: d._id.toString(), userId: d.userId?._id?.toString() ?? d.userId.toString(),
    userName: d.userId?.fullName ?? 'Unknown', amount: d.amount, currency: d.currency,
    network: d.network, walletAddress: d.walletAddress, receiptUrl: d.receiptUrl, status: d.status, createdAt: d.createdAt
  };
}

// ---------------- Withdrawals (spec §27) ----------------

export const listAllWithdrawals = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const filter = status ? { status } : {};
  const withdrawals = await Withdrawal.find(filter).sort({ createdAt: -1 }).populate('userId', 'fullName email');
  res.json(withdrawals.map(serializeWithdrawalWithUser));
});

export const processWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  res.json(await adminService.processWithdrawal(req.params.id, auditContext(req)));
});
export const approveWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  res.json(await adminService.approveWithdrawal(req.params.id, auditContext(req)));
});
export const completeWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  res.json(await adminService.completeWithdrawal(req.params.id, auditContext(req)));
});
export const rejectWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  res.json(await adminService.rejectWithdrawal(req.params.id, auditContext(req)));
});

function serializeWithdrawalWithUser(w: any) {
  return {
    id: w._id.toString(), userId: w.userId?._id?.toString() ?? w.userId.toString(),
    userName: w.userId?.fullName ?? 'Unknown', amount: w.amount, fee: w.fee, netAmount: w.netAmount,
    currency: w.currency, network: w.network, walletAddress: w.walletAddress, status: w.status, createdAt: w.createdAt
  };
}

// ---------------- Trading (spec §28/§29) ----------------

export const listAllTrades = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.pair) filter.pair = req.query.pair;
  if (req.query.userId) filter.userId = req.query.userId;

  const trades = await Trade.find(filter).sort({ createdAt: -1 }).limit(500).populate('userId', 'fullName email');
  res.json(trades.map(serializeTradeWithUser));
});

export const listActiveTradesAdmin = asyncHandler(async (_req: Request, res: Response) => {
  const trades = await Trade.find({ status: 'ACTIVE' }).sort({ startedAt: -1 }).populate('userId', 'fullName email');
  res.json(trades.map(serializeTradeWithUser));
});

/**
 * GET /api/admin/bots/active — every currently-running bot session across
 * all users, with cumulative session P&L computed from its trades so far.
 * This is what lets an admin see "this user's bot is running" (spec ask),
 * independent of any single trade — trades themselves only stay ACTIVE
 * for a few seconds each as botScheduler.service.ts settles them.
 */
export const listActiveBots = asyncHandler(async (_req: Request, res: Response) => {
  const sessions = await BotSession.find({ status: 'ACTIVE' }).sort({ startedAt: -1 }).populate('userId', 'fullName email');

  const withPnl = await Promise.all(
    sessions.map(async (s) => {
      const agg = await Trade.aggregate([
        { $match: { botSessionId: s._id, status: { $in: ['PROFIT', 'LOSS'] } } },
        { $group: { _id: null, total: { $sum: '$profitLoss' }, count: { $sum: 1 } } }
      ]);
      const cumulativePnl = agg[0]?.total ?? 0;
      const tradeCount = agg[0]?.count ?? 0;
      const user = s.userId as unknown as { _id: { toString(): string }; fullName?: string; email?: string };
      return {
        sessionId: s._id.toString(),
        userId: user._id?.toString?.() ?? s.userId.toString(),
        userName: user.fullName ?? 'Unknown',
        userEmail: user.email ?? '',
        investmentAmount: s.investmentAmount,
        stopLossPct: s.stopLossPct,
        takeProfitPct: s.takeProfitPct,
        startedAt: s.startedAt,
        cumulativePnl: Math.round(cumulativePnl * 100) / 100,
        cumulativePnlPct: s.investmentAmount > 0 ? Math.round((cumulativePnl / s.investmentAmount) * 10000) / 100 : 0,
        tradeCount
      };
    })
  );

  res.json(withPnl);
});

/**
 * Admin manually settles a still-ACTIVE trade as either TAKE_PROFIT or
 * STOP_LOSS — a manual override for edge cases. Normal simulated trades
 * settle themselves automatically a few seconds after creation via
 * botScheduler.service.ts, so this window is narrow in practice.
 */
export const settleTradeAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { outcome } = req.body as { outcome: 'TAKE_PROFIT' | 'STOP_LOSS' };
  const trade = await engine.settleTrade(req.params.id, outcome);
  await AuditLog.create({
    adminId: req.user!.id, adminName: req.user!.fullName, action: `Admin settled trade as ${outcome}`,
    targetUserId: trade.userId, targetResource: 'Trade', resourceId: trade._id.toString(),
    newValue: `${trade.profitLoss >= 0 ? '+' : ''}$${trade.profitLoss.toFixed(2)}`, ipAddress: req.ip ?? 'unknown'
  });
  res.json(serializeTrade(trade));
});

function serializeTradeWithUser(t: any) {
  return { ...serializeTrade(t), userId: t.userId?._id?.toString() ?? t.userId.toString(), userName: t.userId?.fullName ?? 'Unknown' };
}

// ---------------- Wallet credit / debit (spec §24/§25) ----------------

export const creditWallet = asyncHandler(async (req: Request, res: Response) => {
  const { amount, reason, description } = req.body;
  const adjustment = await adminService.adjustUserWallet(req.params.id, 'CREDIT_PROFIT', amount, reason, description, auditContext(req));
  res.status(201).json(adjustment);
});

export const debitWallet = asyncHandler(async (req: Request, res: Response) => {
  const { amount, reason, description } = req.body;
  const adjustment = await adminService.adjustUserWallet(req.params.id, 'DEBIT_LOSS', amount, reason, description, auditContext(req));
  res.status(201).json(adjustment);
});

// ---------------- Audit logs (spec §48) ----------------

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 100), 300);
  const logs = await AuditLog.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  res.json(logs);
});

// ---------------- Bot configuration (spec §31) ----------------

export const getBotConfig = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await engine.getBotConfig());
});

export const updateBotConfig = asyncHandler(async (req: Request, res: Response) => {
  const updated = await BotConfig.findOneAndUpdate({ singleton: 'GLOBAL' }, req.body, { new: true, upsert: true });
  await AuditLog.create({
    adminId: req.user!.id, adminName: req.user!.fullName, action: 'Updated bot configuration',
    targetResource: 'BotConfig', newValue: JSON.stringify(req.body), ipAddress: req.ip ?? 'unknown'
  });
  res.json(updated);
});

// ---------------- Arbitrage opportunity configuration (spec §30) ----------------

export const listOpportunityConfigs = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await ArbitrageOpportunityConfig.find());
});

export const upsertOpportunityConfig = asyncHandler(async (req: Request, res: Response) => {
  const { pair } = req.body;
  if (!pair) throw ApiError.badRequest('pair is required.');
  const updated = await ArbitrageOpportunityConfig.findOneAndUpdate({ pair }, req.body, { new: true, upsert: true });
  await AuditLog.create({
    adminId: req.user!.id, adminName: req.user!.fullName, action: `Updated arbitrage opportunity config for ${pair}`,
    targetResource: 'ArbitrageOpportunityConfig', newValue: JSON.stringify(req.body), ipAddress: req.ip ?? 'unknown'
  });
  res.json(updated);
});

// ---------------- Deposit addresses (spec ask: admin-managed receiving addresses for the Deposit page) ----------------

export const listDepositAddresses = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await DepositAddress.find().sort({ currency: 1, network: 1 }));
});

export const createDepositAddress = asyncHandler(async (req: Request, res: Response) => {
  const { currency, network, address } = req.body;

  const existing = await DepositAddress.findOne({
    currency: String(currency).toUpperCase(),
    network: String(network).toUpperCase()
  });
  if (existing) {
    throw ApiError.badRequest(
      `An address for ${currency} on ${network} already exists. Delete it first if you want to replace it.`
    );
  }

  const created = await DepositAddress.create({ currency, network, address, createdBy: req.user!.id });
  await AuditLog.create({
    adminId: req.user!.id, adminName: req.user!.fullName, action: `Added deposit address for ${currency} (${network})`,
    targetResource: 'DepositAddress', resourceId: created._id.toString(), newValue: address, ipAddress: req.ip ?? 'unknown'
  });
  res.status(201).json(created);
});

export const deleteDepositAddress = asyncHandler(async (req: Request, res: Response) => {
  const deleted = await DepositAddress.findByIdAndDelete(req.params.id);
  if (!deleted) throw ApiError.notFound('Deposit address not found.');

  await AuditLog.create({
    adminId: req.user!.id, adminName: req.user!.fullName, action: `Removed deposit address for ${deleted.currency} (${deleted.network})`,
    targetResource: 'DepositAddress', resourceId: deleted._id.toString(), oldValue: deleted.address, ipAddress: req.ip ?? 'unknown'
  });
  res.json({ message: 'Deposit address removed.' });
});

