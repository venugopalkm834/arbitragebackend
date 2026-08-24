import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Wallet } from '../models/Wallet';
import { WalletTransaction } from '../models/WalletTransaction';

export const getWallet = asyncHandler(async (req: Request, res: Response) => {
  const wallet = await Wallet.findOne({ userId: req.user!.id });
  if (!wallet) throw ApiError.notFound('Wallet not found.');
  res.json({
    id: wallet._id.toString(),
    userId: wallet.userId.toString(),
    currency: wallet.currency,
    balance: wallet.balance,
    availableBalance: wallet.availableBalance,
    lockedBalance: wallet.lockedBalance,
    totalProfit: wallet.totalProfit,
    totalLoss: wallet.totalLoss
  });
});

export const getTransactions = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const transactions = await WalletTransaction.find({ userId: req.user!.id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  res.json(transactions.map(serializeTransaction));
});

function serializeTransaction(tx: InstanceType<typeof WalletTransaction>) {
  return {
    id: tx._id.toString(),
    type: tx.type,
    amount: tx.amount,
    balanceBefore: tx.balanceBefore,
    balanceAfter: tx.balanceAfter,
    referenceId: tx.referenceId,
    description: tx.description,
    createdAt: tx.createdAt
  };
}
