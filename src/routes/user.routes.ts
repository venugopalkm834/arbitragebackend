import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { getMyReferralInfo, getMyReferralDailyEarnings } from '../controllers/referral.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { updateProfileSchema, changePasswordSchema, confirmEnable2faSchema, disable2faSchema } from '../validators/user.validators';

const router = Router();
router.use(requireAuth);

router.get('/me', userController.getMe);
router.put('/me', validateBody(updateProfileSchema), userController.updateMe);
router.put('/change-password', validateBody(changePasswordSchema), userController.changePassword);
router.get('/me/referral', getMyReferralInfo);
router.get('/me/referral/daily', getMyReferralDailyEarnings);

router.post('/2fa/enable', userController.requestEnable2fa);
router.post('/2fa/enable/confirm', validateBody(confirmEnable2faSchema), userController.confirmEnable2fa);
router.post('/2fa/disable', validateBody(disable2faSchema), userController.disable2fa);

export default router;
