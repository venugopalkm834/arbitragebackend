import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { logger } from '../utils/logger';
import { hashPassword } from '../utils/password';
import { generateUniqueReferralCode } from '../utils/referral';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { WalletTransaction } from '../models/WalletTransaction';
import { Deposit } from '../models/Deposit';
import { Withdrawal } from '../models/Withdrawal';
import { BotConfig } from '../models/BotConfig';
import { ArbitrageOpportunityConfig } from '../models/ArbitrageOpportunityConfig';
import { Trade } from '../models/Trade';
import { BotSession } from '../models/BotSession';

const PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'ADA/USDT', 'DOGE/USDT'];

/**
 * Seeds:
 *  - one SUPER_ADMIN and one demo USER (credentials from env — spec §57:
 *    "should be configured through environment variables rather than
 *    hard-coded into production code")
 *  - each user's wallet + an initial-deposit ledger entry
 *  - the singleton BotConfig and one ArbitrageOpportunityConfig per pair
 *  - a few sample deposits, withdrawals, and a closed trade for the demo
 *    user, so the admin panel and history pages aren't empty on first run
 *
 * Idempotent-ish: re-running skips users/config that already exist rather
 * than erroring, but will add duplicate sample deposits/withdrawals/trades
 * each run — fine for a dev seed script, not intended for production reseeding.
 */
async function seed(): Promise<void> {
  await connectDatabase();

  await seedBotConfig();
  await seedOpportunityConfigs();
  const admin = await seedUser({
    fullName: 'Platform Admin',
    username: 'admin',
    email: env.seedAdminEmail,
    mobile: '+1 555 000 0001',
    password: env.seedAdminPassword,
    role: 'SUPER_ADMIN'
  });
  const demo = await seedUser({
    fullName: 'Demo Trader',
    username: 'demo',
    email: env.seedDemoEmail,
    mobile: '+1 555 000 0002',
    password: env.seedDemoPassword,
    role: 'USER'
  });

  if (demo) {
    await seedSampleActivity(demo._id, admin?._id);
  }

  logger.info('Seed complete.');
  logger.info(`Admin login:  ${env.seedAdminEmail} / (see .env SEED_ADMIN_PASSWORD)`);
  logger.info(`Demo login:   ${env.seedDemoEmail} / (see .env SEED_DEMO_PASSWORD)`);

  await disconnectDatabase();
}

async function seedBotConfig(): Promise<void> {
  const existing = await BotConfig.findOne({ singleton: 'GLOBAL' });
  if (existing) return;
  await BotConfig.create({ singleton: 'GLOBAL', supportedPairs: PAIRS });
  logger.info('Seeded BotConfig.');
}

async function seedOpportunityConfigs(): Promise<void> {
  for (const pair of PAIRS) {
    await ArbitrageOpportunityConfig.findOneAndUpdate(
      { pair },
      { pair, exchangeA: 'Exchange A Simulator', exchangeB: 'Exchange B Simulator', minSpreadPct: 0.2, maxSpreadPct: 1.5, tradingFeePct: 0.1, enabled: true },
      { upsert: true }
    );
  }
  logger.info(`Seeded ${PAIRS.length} ArbitrageOpportunityConfig rows.`);
}

interface SeedUserInput {
  fullName: string; username: string; email: string; mobile: string; password: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

async function seedUser(input: SeedUserInput) {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    logger.info(`User already exists, skipping: ${input.email}`);
    return existing;
  }

  const passwordHash = await hashPassword(input.password);
  const referralCode = await generateUniqueReferralCode();
  const user = await User.create({
    fullName: input.fullName, username: input.username, email: input.email.toLowerCase(),
    mobile: input.mobile, passwordHash, role: input.role, status: 'ACTIVE', isEmailVerified: true, referralCode
  });

  const startingBalance = input.role === 'USER' ? env.demoStartingBalance : 0;
  const wallet = await Wallet.create({
    userId: user._id, currency: 'USDT', balance: startingBalance, availableBalance: startingBalance, lockedBalance: 0
  });

  if (startingBalance > 0) {
    await WalletTransaction.create({
      userId: user._id, walletId: wallet._id, type: 'DEPOSIT', amount: startingBalance,
      balanceBefore: 0, balanceAfter: startingBalance, description: 'Initial demo account balance', createdBy: user._id
    });
  }

  logger.info(`Seeded ${input.role} user: ${input.email}`);
  return user;
}

async function seedSampleActivity(userId: mongoose.Types.ObjectId, adminId?: mongoose.Types.ObjectId): Promise<void> {
  await Deposit.create({
    userId, amount: 1500, currency: 'USDT', network: 'USDT TRC20',
    walletAddress: 'TQn9Y2khEsLMWD4z...DEMO', status: 'APPROVED', approvedBy: adminId, approvedAt: new Date()
  });
  await Deposit.create({
    userId, amount: 800, currency: 'USDT', network: 'USDT ERC20',
    walletAddress: '0x8f3Cf7ad23Cd3...DEMO', status: 'PENDING'
  });

  await Withdrawal.create({
    userId, amount: 250, fee: 2.5, netAmount: 247.5, currency: 'USDT', network: 'USDT TRC20',
    walletAddress: 'TQn9Y2khEsLMWD4z...OUT', status: 'PENDING'
  });

  const botSession = await BotSession.create({
    userId, investmentAmount: 1000, stopLossPct: 2, takeProfitPct: 5, status: 'STOPPED',
    startedAt: new Date(Date.now() - 3600_000), stoppedAt: new Date(Date.now() - 3000_000)
  });

  await Trade.create({
    ticket: 'TRD-10001', userId, botSessionId: botSession._id, pair: 'BTC/USDT',
    buyExchange: 'Exchange A Simulator', sellExchange: 'Exchange B Simulator',
    investmentAmount: 1000, entryValue: 1000, currentValue: 1050, exitValue: 1050,
    stopLossPct: 2, takeProfitPct: 5, profitLoss: 50, profitLossPct: 5,
    status: 'TAKE_PROFIT', closeReason: 'TAKE_PROFIT',
    startedAt: new Date(Date.now() - 3600_000), closedAt: new Date(Date.now() - 3000_000)
  });

  logger.info('Seeded sample deposits, withdrawal, and one closed (take-profit) trade for the demo user.');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seed failed', err);
    process.exit(1);
  });
