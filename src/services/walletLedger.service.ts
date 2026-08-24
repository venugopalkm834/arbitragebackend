import mongoose, { ClientSession, Types } from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { IWallet, Wallet } from '../models/Wallet';
import { IWalletTransaction, WalletTransaction, WalletTransactionType } from '../models/WalletTransaction';

export interface LedgerEntryInput {
  userId: Types.ObjectId | string;
  type: WalletTransactionType;
  amount: number; // always positive; the type determines direction
  referenceId?: string;
  description: string;
  createdBy: Types.ObjectId | string;
}

/**
 * wallet-ledger.service.ts
 * -------------------------
 * The ONLY code path allowed to mutate `wallet.balance` /
 * `availableBalance` / `lockedBalance` (spec §34/§42). Every call:
 *   1. Opens (or reuses) a Mongo session/transaction.
 *   2. Locks the wallet row for update (via the session).
 *   3. Validates the operation won't drive a balance negative.
 *   4. Writes the wallet mutation AND the WalletTransaction ledger row
 *      atomically — if either fails, both roll back.
 *
 * Controllers/services never call `Wallet.updateOne({ balance: ... })`
 * directly; they call `applyLedgerEntry` (or the lock/release/finalize
 * helpers below) instead.
 *
 * NOTE: multi-document transactions require MongoDB to be running as a
 * replica set (a single free-tier Atlas cluster already is one; local
 * standalone mongod needs `rs.initiate()` once). See README.
 */
export async function applyLedgerEntry(
  input: LedgerEntryInput,
  externalSession?: ClientSession
): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
  const session = externalSession ?? (await mongoose.startSession());
  const ownsSession = !externalSession;

  try {
    if (ownsSession) session.startTransaction();

    const wallet = await Wallet.findOne({ userId: input.userId }).session(session);
    if (!wallet) throw ApiError.notFound('Wallet not found.');

    const balanceBefore = wallet.balance;
    let balanceAfter = balanceBefore;

    switch (input.type) {
      case 'DEPOSIT':
      case 'ADMIN_CREDIT':
      case 'TRADE_REFUND':
        balanceAfter = balanceBefore + input.amount;
        wallet.availableBalance += input.amount;
        wallet.balance = balanceAfter;
        break;

      case 'TRADE_PROFIT':
        balanceAfter = balanceBefore + input.amount;
        wallet.availableBalance += input.amount;
        wallet.totalProfit += input.amount;
        wallet.balance = balanceAfter;
        break;

      case 'REFERRAL_COMMISSION':
        // Credited to the REFERRER's wallet when someone they referred earns
        // a trade profit (spec ask: admin-configurable %, withdrawable like
        // any other balance — it lands in the same balance/availableBalance
        // fields, so the existing withdrawal flow already covers it).
        balanceAfter = balanceBefore + input.amount;
        wallet.availableBalance += input.amount;
        wallet.balance = balanceAfter;
        break;

      case 'WITHDRAWAL':
        // The amount was already moved available -> locked at request
        // time (see lockAmount / withdrawal.controller.ts), so completing
        // a withdrawal must clear it out of lockedBalance here, not
        // availableBalance — leaving lockedBalance untouched was a bug:
        // that amount would stay stuck as "locked" forever.
        balanceAfter = balanceBefore - input.amount;
        assertNonNegative(balanceAfter, 'balance');
        wallet.lockedBalance = Math.max(0, wallet.lockedBalance - input.amount);
        wallet.balance = balanceAfter;
        break;

      case 'ADMIN_DEBIT':
        balanceAfter = balanceBefore - input.amount;
        assertNonNegative(balanceAfter, 'balance');
        wallet.availableBalance -= input.amount;
        assertNonNegative(wallet.availableBalance, 'availableBalance');
        wallet.totalLoss += input.amount;
        wallet.balance = balanceAfter;
        break;

      case 'TRADE_LOSS':
        balanceAfter = balanceBefore - input.amount;
        assertNonNegative(balanceAfter, 'balance');
        wallet.availableBalance -= input.amount;
        assertNonNegative(wallet.availableBalance, 'availableBalance');
        wallet.totalLoss += input.amount;
        wallet.balance = balanceAfter;
        break;

      case 'TRADE_INVESTMENT':
        // Total balance unchanged — just available -> locked.
        if (wallet.availableBalance < input.amount) {
          throw ApiError.badRequest('Insufficient available balance for this investment amount.');
        }
        wallet.availableBalance -= input.amount;
        wallet.lockedBalance += input.amount;
        break;

      case 'FEE':
        balanceAfter = balanceBefore - input.amount;
        assertNonNegative(balanceAfter, 'balance');
        wallet.availableBalance -= input.amount;
        assertNonNegative(wallet.availableBalance, 'availableBalance');
        wallet.balance = balanceAfter;
        break;
    }

    await wallet.save({ session });

    const [transaction] = await WalletTransaction.create(
      [
        {
          userId: input.userId,
          walletId: wallet._id,
          type: input.type,
          amount: input.amount,
          balanceBefore,
          balanceAfter: wallet.balance,
          referenceId: input.referenceId,
          description: input.description,
          createdBy: input.createdBy
        }
      ],
      { session }
    );

    if (ownsSession) await session.commitTransaction();
    return { wallet, transaction };
  } catch (err) {
    if (ownsSession) await session.abortTransaction();
    throw err;
  } finally {
    if (ownsSession) session.endSession();
  }
}

/** Moves `amount` from available -> locked with no ledger row yet (e.g. a pending withdrawal request). */
export async function lockAmount(userId: Types.ObjectId | string, amount: number, session?: ClientSession): Promise<IWallet> {
  const wallet = await Wallet.findOne({ userId }).session(session ?? null);
  if (!wallet) throw ApiError.notFound('Wallet not found.');
  if (wallet.availableBalance < amount) throw ApiError.badRequest('Insufficient available balance.');
  wallet.availableBalance -= amount;
  wallet.lockedBalance += amount;
  await wallet.save({ session });
  return wallet;
}

/** Reverses lockAmount — e.g. a withdrawal was rejected, or a trade investment lock needs releasing. */
export async function releaseLocked(userId: Types.ObjectId | string, amount: number, session?: ClientSession): Promise<IWallet> {
  const wallet = await Wallet.findOne({ userId }).session(session ?? null);
  if (!wallet) throw ApiError.notFound('Wallet not found.');
  wallet.lockedBalance = Math.max(0, wallet.lockedBalance - amount);
  wallet.availableBalance += amount;
  await wallet.save({ session });
  return wallet;
}

function assertNonNegative(value: number, field: string): void {
  if (value < -0.0001) {
    throw ApiError.badRequest(`Operation would drive ${field} negative — rejected.`);
  }
}
