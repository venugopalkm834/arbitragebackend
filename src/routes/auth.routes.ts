import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { authRateLimiter } from '../middleware/rateLimit.middleware';
import { registerSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema, verifyOtpSchema, resendOtpSchema, verifyEmailSchema, resendEmailVerificationSchema } from '../validators/auth.validators';

const router = Router();

router.post('/register', authRateLimiter, validateBody(registerSchema), authController.register);
router.post('/verify-email', authRateLimiter, validateBody(verifyEmailSchema), authController.verifyEmail);
router.post('/resend-email-otp', authRateLimiter, validateBody(resendOtpSchema), authController.resendEmailOtp);
router.post('/resend-email-verification', authRateLimiter, validateBody(resendEmailVerificationSchema), authController.resendEmailVerification);
router.post('/login', authRateLimiter, validateBody(loginSchema), authController.login);
router.post('/verify-otp', authRateLimiter, validateBody(verifyOtpSchema), authController.verifyOtp);
router.post('/resend-otp', authRateLimiter, validateBody(resendOtpSchema), authController.resendOtp);
router.post('/refresh', validateBody(refreshSchema), authController.refresh);
router.post('/logout', requireAuth, authController.logout);
router.post('/forgot-password', authRateLimiter, validateBody(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authRateLimiter, validateBody(resetPasswordSchema), authController.resetPassword);
router.get('/me', requireAuth, authController.me);

export default router;
