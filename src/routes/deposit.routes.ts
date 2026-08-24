import { Router } from 'express';
import * as depositController from '../controllers/deposit.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { uploadReceipt } from '../middleware/upload.middleware';
import { depositSchema } from '../validators/wallet.validators';

const router = Router();
router.use(requireAuth);

// uploadReceipt runs first so multer parses the multipart body into
// req.body (strings) + req.file, THEN validateBody checks the fields.
router.post('/', uploadReceipt, validateBody(depositSchema), depositController.createDeposit);
router.get('/', depositController.listDeposits);
router.get('/:id', depositController.getDeposit);

export default router;
