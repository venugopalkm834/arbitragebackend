import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { User } from '../models/User';
import { WalletTransaction } from '../models/WalletTransaction';
import { BotConfig } from '../models/BotConfig';

/**
 * GET /api/users/me/referral
 * Everything the user needs to see and share their referral program
 * status: their own code, how many people they've referred, the current
 * admin-set commission %, and how much they've earned so far (which is
 * just a normal part of wallet.balance via REFERRAL_COMMISSION ledger
 * rows — already withdrawable through the existing withdrawal flow).
 */
export const getMyReferralInfo = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found.');

  const [referredCount, earnings, config] = await Promise.all([
    User.countDocuments({ referredBy: user._id }),
    WalletTransaction.aggregate([
      { $match: { userId: user._id, type: 'REFERRAL_COMMISSION' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    BotConfig.findOne({ singleton: 'GLOBAL' })
  ]);

  res.json({
    referralCode: user.referralCode,
    referredCount,
    totalEarned: Math.round((earnings[0]?.total ?? 0) * 100) / 100,
    commissionCount: earnings[0]?.count ?? 0,
    commissionPct: config?.referralCommissionPct ?? 10
  });
});

/**
 * GET /api/users/me/referral/daily
 * Day-by-day commission breakdown for the referrer (the "child profit
 * commission should display daily basis for the parent" ask) — one row
 * per calendar day that had at least one REFERRAL_COMMISSION credit,
 * newest first. Grouped in Mongo (not in JS) so it stays cheap even with
 * a large ledger. Defaults to the last 30 days; pass ?days=N to widen.
 */
export const getMyReferralDailyEarnings = asyncHandler(async (req: Request, res: Response) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await WalletTransaction.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(req.user!.id), type: 'REFERRAL_COMMISSION', createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: -1 } },
    { $project: { _id: 0, date: '$_id', total: { $round: ['$total', 2] }, count: 1 } }
  ]);

  res.json({ days, rows });
});
