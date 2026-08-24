import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import walletRoutes from './wallet.routes';
import depositRoutes from './deposit.routes';
import withdrawalRoutes from './withdrawal.routes';
import tradeRoutes from './trade.routes';
import arbitrageRoutes from './arbitrage.routes';
import performanceRoutes from './performance.routes';
import adminRoutes from './admin.routes';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/wallet', walletRoutes);
router.use('/deposits', depositRoutes);
router.use('/withdrawals', withdrawalRoutes);
router.use('/trades', tradeRoutes);
router.use('/arbitrage', arbitrageRoutes);
router.use('/performance', performanceRoutes);
router.use('/admin', adminRoutes);

export default router;
