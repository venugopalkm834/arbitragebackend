import { Router } from 'express';
import * as withdrawalController from '../controllers/withdrawal.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { withdrawalSchema } from '../validators/wallet.validators';

const router = Router();
router.use(requireAuth);

router.post('/', validateBody(withdrawalSchema), withdrawalController.createWithdrawal);
router.get('/', withdrawalController.listWithdrawals);
router.get('/:id', withdrawalController.getWithdrawal);

export default router;
