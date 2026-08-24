import { Router } from 'express';
import * as arbitrageController from '../controllers/arbitrage.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { startTradeSchema } from '../validators/trade.validators';

const router = Router();

router.get('/opportunities', requireAuth, arbitrageController.getOpportunities);
router.post('/start', requireAuth, validateBody(startTradeSchema), arbitrageController.startArbitrage);

export default router;
