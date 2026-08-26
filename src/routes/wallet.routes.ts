import { Router } from 'express';
import * as walletController from '../controllers/wallet.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();
router.use(requireAuth);

router.get('/', walletController.getWallet);
router.get('/transactions', walletController.getTransactions);
router.get('/deposit-addresses', walletController.getDepositAddresses);

export default router;
