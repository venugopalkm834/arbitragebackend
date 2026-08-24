import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { AdminAdjustment, AdjustmentType } from '../models/AdminAdjustment';
import { AuditLog } from '../models/AuditLog';
import { Deposit } from '../models/Deposit';
import { User, UserStatus } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Withdrawal } from '../models/Withdrawal';
import { applyLedgerEntry, lockAmount, releaseLocked } from './walletLedger.service';
import { pushNotification } from './notification.service';
import { wsHub } from '../websocket/hub';

export interface AuditContext {
  adminId: string;
  adminName: string;
  ipAddress: string;
}

async function writeAudit(ctx: AuditContext, action: string, opts: {
  targetUserId?: string; targetResource?: string; resourceId?: string; oldValue?: string; newValue?: string;
} = {}): Promise<void> {
  await AuditLog.create({
    adminId: ctx.adminId,
    adminName: ctx.adminName,
    action,
    ipAddress: ctx.ipAddress,
    ...opts
  });
}

// ---------------- Deposits (spec §26) ----------------

export async function approveDeposit(depositId: string, ctx: AuditContext) {
  const deposit = await Deposit.findById(depositId);
  if (!deposit) throw ApiError.notFound('Deposit not found.');
  if (deposit.status !== 'PENDING') throw ApiError.badRequest('Deposit is not pending.');

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    deposit.status = 'APPROVED';
    deposit.approvedBy = new mongoose.Types.ObjectId(ctx.adminId);
    deposit.approvedAt = new Date();
    await deposit.save({ session });

    await applyLedgerEntry(
      {
        userId: deposit.userId,
        type: 'DEPOSIT',
        amount: deposit.amount,
        referenceId: deposit._id.toString(),
        description: `Deposit approved (${deposit.network})`,
        createdBy: ctx.adminId
      },
      session
    );

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  await pushNotification(deposit.userId, 'DEPOSIT_APPROVED', `Your deposit of $${deposit.amount.toFixed(2)} has been approved.`);
  await emitWalletUpdate(deposit.userId.toString());
  await writeAudit(ctx, 'Approved deposit', {
    targetUserId: deposit.userId.toString(), targetResource: 'Deposit', resourceId: deposit._id.toString(),
    newValue: `+$${deposit.amount.toFixed(2)}`
  });

  return deposit;
}

export async function rejectDeposit(depositId: string, ctx: AuditContext) {
  const deposit = await Deposit.findById(depositId);
  if (!deposit) throw ApiError.notFound('Deposit not found.');
  if (deposit.status !== 'PENDING') throw ApiError.badRequest('Deposit is not pending.');

  deposit.status = 'REJECTED';
  await deposit.save();

  await writeAudit(ctx, 'Rejected deposit', {
    targetUserId: deposit.userId.toString(), targetResource: 'Deposit', resourceId: deposit._id.toString()
  });

  return deposit;
}

// ---------------- Withdrawals (spec §27) ----------------

export async function processWithdrawal(withdrawalId: string, ctx: AuditContext) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) throw ApiError.notFound('Withdrawal not found.');
  if (withdrawal.status !== 'PENDING') throw ApiError.badRequest('Withdrawal is not pending.');

  withdrawal.status = 'PROCESSING';
  await withdrawal.save();
  await writeAudit(ctx, 'Marked withdrawal as processing', { targetUserId: withdrawal.userId.toString(), targetResource: 'Withdrawal', resourceId: withdrawal._id.toString() });
  return withdrawal;
}

export async function approveWithdrawal(withdrawalId: string, ctx: AuditContext) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) throw ApiError.notFound('Withdrawal not found.');
  if (withdrawal.status !== 'PROCESSING') throw ApiError.badRequest('Withdrawal must be PROCESSING before approval.');

  withdrawal.status = 'APPROVED';
  await withdrawal.save();
  await writeAudit(ctx, 'Approved withdrawal', { targetUserId: withdrawal.userId.toString(), targetResource: 'Withdrawal', resourceId: withdrawal._id.toString() });
  return withdrawal;
}

export async function completeWithdrawal(withdrawalId: string, ctx: AuditContext) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) throw ApiError.notFound('Withdrawal not found.');
  if (withdrawal.status !== 'APPROVED') throw ApiError.badRequest('Withdrawal must be APPROVED before completion.');

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Goes through the shared ledger helper — walletLedger.service.ts is
    // documented as the only code path allowed to mutate wallet balances;
    // this used to duplicate that mutation inline here instead.
    await applyLedgerEntry(
      {
        userId: withdrawal.userId,
        type: 'WITHDRAWAL',
        amount: withdrawal.amount,
        referenceId: withdrawal._id.toString(),
        description: 'Withdrawal completed',
        createdBy: ctx.adminId
      },
      session
    );

    withdrawal.status = 'COMPLETED';
    withdrawal.processedBy = new mongoose.Types.ObjectId(ctx.adminId);
    withdrawal.processedAt = new Date();
    await withdrawal.save({ session });

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  await pushNotification(withdrawal.userId, 'WITHDRAWAL_APPROVED', `Your withdrawal of $${withdrawal.amount.toFixed(2)} has been completed.`);
  await emitWalletUpdate(withdrawal.userId.toString());
  await writeAudit(ctx, 'Completed withdrawal', {
    targetUserId: withdrawal.userId.toString(), targetResource: 'Withdrawal', resourceId: withdrawal._id.toString(),
    newValue: `-$${withdrawal.amount.toFixed(2)}`
  });

  return withdrawal;
}

/**
 * One-click withdrawal approval — collapses the PENDING → PROCESSING →
 * APPROVED → COMPLETED lifecycle into a single admin action, for the
 * common case where an admin just wants to pay a withdrawal out
 * immediately rather than stepping through each stage. Valid from any
 * pre-terminal status (PENDING, PROCESSING, or APPROVED).
 */
export async function approveAndCompleteWithdrawal(withdrawalId: string, ctx: AuditContext) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) throw ApiError.notFound('Withdrawal not found.');
  if (withdrawal.status === 'COMPLETED') throw ApiError.badRequest('Withdrawal is already completed.');
  if (withdrawal.status === 'REJECTED') throw ApiError.badRequest('Cannot complete a rejected withdrawal.');

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    await applyLedgerEntry(
      {
        userId: withdrawal.userId,
        type: 'WITHDRAWAL',
        amount: withdrawal.amount,
        referenceId: withdrawal._id.toString(),
        description: 'Withdrawal completed (one-click approval)',
        createdBy: ctx.adminId
      },
      session
    );

    withdrawal.status = 'COMPLETED';
    withdrawal.processedBy = new mongoose.Types.ObjectId(ctx.adminId);
    withdrawal.processedAt = new Date();
    await withdrawal.save({ session });

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  await pushNotification(withdrawal.userId, 'WITHDRAWAL_APPROVED', `Your withdrawal of $${withdrawal.netAmount.toFixed(2)} has been completed.`);
  await emitWalletUpdate(withdrawal.userId.toString());
  await writeAudit(ctx, 'Approved and completed withdrawal (one-click)', {
    targetUserId: withdrawal.userId.toString(), targetResource: 'Withdrawal', resourceId: withdrawal._id.toString(),
    newValue: `-$${withdrawal.amount.toFixed(2)}`
  });

  return withdrawal;
}

export async function rejectWithdrawal(withdrawalId: string, ctx: AuditContext) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) throw ApiError.notFound('Withdrawal not found.');
  if (withdrawal.status === 'COMPLETED') throw ApiError.badRequest('Cannot reject a completed withdrawal.');

  await releaseLocked(withdrawal.userId, withdrawal.amount);
  withdrawal.status = 'REJECTED';
  await withdrawal.save();

  await pushNotification(withdrawal.userId, 'WITHDRAWAL_REJECTED', `Your withdrawal request of $${withdrawal.amount.toFixed(2)} was rejected and the funds returned.`);
  await emitWalletUpdate(withdrawal.userId.toString());
  await writeAudit(ctx, 'Rejected withdrawal — locked amount returned', { targetUserId: withdrawal.userId.toString(), targetResource: 'Withdrawal', resourceId: withdrawal._id.toString() });

  return withdrawal;
}

// ---------------- Wallet credit / debit (spec §24/§25) ----------------

export async function adjustUserWallet(
  userId: string,
  type: AdjustmentType,
  amount: number,
  reason: string,
  description: string,
  ctx: AuditContext
) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const adjustment = (
      await AdminAdjustment.create([{ adminId: ctx.adminId, userId, type, amount, reason, description }], { session })
    )[0];

    await applyLedgerEntry(
      {
        userId,
        type: type === 'CREDIT_PROFIT' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        amount,
        referenceId: adjustment._id.toString(),
        description: `${reason}: ${description}`,
        createdBy: ctx.adminId
      },
      session
    );

    await session.commitTransaction();

    await pushNotification(
      userId,
      type === 'CREDIT_PROFIT' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
      `${type === 'CREDIT_PROFIT' ? 'A credit' : 'A debit'} of $${amount.toFixed(2)} was applied to your wallet: ${reason}.`
    );
    await emitWalletUpdate(userId);
    await writeAudit(ctx, type === 'CREDIT_PROFIT' ? `Credited user $${amount.toFixed(2)} — ${reason}` : `Debited user $${amount.toFixed(2)} — ${reason}`, {
      targetUserId: userId, targetResource: 'Wallet',
      newValue: `${type === 'CREDIT_PROFIT' ? '+' : '-'}$${amount.toFixed(2)}`
    });

    return adjustment;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ---------------- User status ----------------

export async function setUserStatus(userId: string, status: UserStatus, ctx: AuditContext) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found.');

  const oldStatus = user.status;
  user.status = status;
  await user.save();

  await writeAudit(ctx, status === 'BLOCKED' ? 'Blocked user' : 'Changed user status', {
    targetUserId: userId, targetResource: 'User', resourceId: userId, oldValue: oldStatus, newValue: status
  });

  return user;
}

async function emitWalletUpdate(userId: string): Promise<void> {
  const wallet = await Wallet.findOne({ userId });
  if (!wallet) return;
  wsHub.emitToUser(userId, 'wallet:update', {
    balance: wallet.balance, availableBalance: wallet.availableBalance, lockedBalance: wallet.lockedBalance,
    totalProfit: wallet.totalProfit, totalLoss: wallet.totalLoss
  });
}

