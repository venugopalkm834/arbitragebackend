import { Router } from 'express';
import * as performanceController from '../controllers/performance.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();
router.use(requireAuth);

router.get('/monthly', performanceController.getMonthlyPerformance);
router.get('/monthly/history', performanceController.getMonthlyPerformanceHistory);
router.get('/daily', performanceController.getDailyPerformance);

export default router;
