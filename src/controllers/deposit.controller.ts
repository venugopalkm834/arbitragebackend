import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Deposit } from '../models/Deposit';
import { receiptUrlFor } from '../middleware/upload.middleware';
import { wsHub } from '../websocket/hub';

const MIN_DEPOSIT = 20;
const MAX_DEPOSIT = 250000;

export const createDeposit = asyncHandler(async (req: Request, res: Response) => {
  const { amount, currency, network, walletAddress } = req.body;
  if (amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) {
    throw ApiError.badRequest(`Deposit amount must be between $${MIN_DEPOSIT} and $${MAX_DEPOSIT}.`);
  }

  // req.file is set by the uploadReceipt (multer) middleware when the
  // user attached a proof-of-payment screenshot/PDF — optional.
  const receiptUrl = req.file ? receiptUrlFor(req.file.filename) : undefined;

  const deposit = await Deposit.create({ userId: req.user!.id, amount, currency, network, walletAddress, receiptUrl, status: 'PENDING' });

  // Notify any connected admins so their deposit queue can refresh live.
  wsHub.emitToAdmins('deposit:update', { id: deposit._id.toString(), status: 'PENDING' });

  res.status(201).json(serializeDeposit(deposit));
});

export const listDeposits = asyncHandler(async (req: Request, res: Response) => {
  const deposits = await Deposit.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  res.json(deposits.map(serializeDeposit));
});

export const getDeposit = asyncHandler(async (req: Request, res: Response) => {
  const deposit = await Deposit.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!deposit) throw ApiError.notFound('Deposit not found.');
  res.json(serializeDeposit(deposit));
});

function serializeDeposit(d: InstanceType<typeof Deposit>) {
  return {
    id: d._id.toString(), userId: d.userId.toString(), amount: d.amount, currency: d.currency,
    network: d.network, walletAddress: d.walletAddress, receiptUrl: d.receiptUrl, status: d.status, createdAt: d.createdAt
  };
}
