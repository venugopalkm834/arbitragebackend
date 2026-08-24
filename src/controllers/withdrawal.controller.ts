import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Withdrawal } from '../models/Withdrawal';
import { lockAmount } from '../services/walletLedger.service';
import { wsHub } from '../websocket/hub';

const MIN_WITHDRAWAL = 20;
const MAX_WITHDRAWAL = 100000;
const FEE_PCT = 1;

export const createWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const { amount, currency, network, walletAddress } = req.body;
  if (amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
    throw ApiError.badRequest(`Withdrawal amount must be between $${MIN_WITHDRAWAL} and $${MAX_WITHDRAWAL}.`);
  }

  // Lock the requested amount immediately (available -> locked) so the
  // user can't spend/withdraw it twice while the request is pending.
  await lockAmount(req.user!.id, amount);

  const fee = Math.round(amount * (FEE_PCT / 100) * 100) / 100;
  const withdrawal = await Withdrawal.create({
    userId: req.user!.id, amount, fee, netAmount: Math.round((amount - fee) * 100) / 100,
    currency, network, walletAddress, status: 'PENDING'
  });

  wsHub.emitToAdmins('withdrawal:update', { id: withdrawal._id.toString(), status: 'PENDING' });

  res.status(201).json(serializeWithdrawal(withdrawal));
});

export const listWithdrawals = asyncHandler(async (req: Request, res: Response) => {
  const withdrawals = await Withdrawal.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  res.json(withdrawals.map(serializeWithdrawal));
});

export const getWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const withdrawal = await Withdrawal.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!withdrawal) throw ApiError.notFound('Withdrawal not found.');
  res.json(serializeWithdrawal(withdrawal));
});

function serializeWithdrawal(w: InstanceType<typeof Withdrawal>) {
  return {
    id: w._id.toString(), userId: w.userId.toString(), amount: w.amount, fee: w.fee, netAmount: w.netAmount,
    currency: w.currency, network: w.network, walletAddress: w.walletAddress, status: w.status, createdAt: w.createdAt
  };
}
