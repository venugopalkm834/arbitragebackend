import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { walletAdjustmentSchema, userStatusSchema, botConfigSchema, settleTradeSchema } from '../validators/admin.validators';

const router = Router();

// spec §39: protect all admin endpoints using JWT + Role Guard (ADMIN / SUPER_ADMIN).
router.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

router.get('/dashboard', adminController.getDashboard);

router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUser);
router.put('/users/:id', adminController.updateUser);
router.put('/users/:id/status', validateBody(userStatusSchema), adminController.updateUserStatus);
router.post('/users/:id/wallet/credit', validateBody(walletAdjustmentSchema), adminController.creditWallet);
router.post('/users/:id/wallet/debit', validateBody(walletAdjustmentSchema), adminController.debitWallet);

router.get('/deposits', adminController.listAllDeposits);
router.post('/deposits/:id/approve', adminController.approveDeposit);
router.post('/deposits/:id/reject', adminController.rejectDeposit);

router.get('/withdrawals', adminController.listAllWithdrawals);
router.post('/withdrawals/:id/process', adminController.processWithdrawal);
router.post('/withdrawals/:id/approve', adminController.approveWithdrawal);
// One-click: PENDING/PROCESSING/APPROVED -> COMPLETED in a single action.
router.post('/withdrawals/:id/approve-and-complete', adminController.approveAndCompleteWithdrawal);
router.post('/withdrawals/:id/complete', adminController.completeWithdrawal);
router.post('/withdrawals/:id/reject', adminController.rejectWithdrawal);

router.get('/trades', adminController.listAllTrades);
router.get('/trades/active', adminController.listActiveTradesAdmin);
router.get('/bots/active', adminController.listActiveBots);
// Admin manually settles an ACTIVE trade as its own take-profit or stop-loss outcome
// (replaces the old automatic/random simulation engine).
router.post('/trades/:id/settle', validateBody(settleTradeSchema), adminController.settleTradeAdmin);

router.get('/audit-logs', adminController.listAuditLogs);

// spec §31 — bot configuration. SUPER_ADMIN only, since it affects platform-wide risk limits.
router.get('/bot-config', adminController.getBotConfig);
router.put('/bot-config', requireRole('SUPER_ADMIN'), validateBody(botConfigSchema), adminController.updateBotConfig);

// spec §30 — per-pair arbitrage opportunity configuration.
router.get('/arbitrage-opportunities', adminController.listOpportunityConfigs);
router.put('/arbitrage-opportunities', requireRole('SUPER_ADMIN'), adminController.upsertOpportunityConfig);

export default router;
