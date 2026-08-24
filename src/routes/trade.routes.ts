import { Router } from 'express';
import * as tradeController from '../controllers/trade.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { startTradeSchema } from '../validators/trade.validators';

const router = Router();
router.use(requireAuth);

router.post('/start', validateBody(startTradeSchema), tradeController.startTrade);
router.post('/:id/stop', tradeController.stopTrade);
router.get('/status', tradeController.getBotStatus);
router.get('/active', tradeController.listActiveTrades);
router.get('/history', tradeController.listTradeHistory);
router.get('/:id', tradeController.getTrade);

export default router;
