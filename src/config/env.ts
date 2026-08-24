import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',

  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/arbitrex?replicaSet=rs0'),

  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-only-access-secret'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev-only-refresh-secret'),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  // Short-lived token identifying an in-progress 2FA login challenge — separate
  // secret from the access/refresh tokens so a leaked challenge token alone
  // can never be used as (or forged into) a real session token.
  jwtTwoFactorSecret: required('JWT_2FA_SECRET', 'dev-only-2fa-secret'),
  twoFactorOtpExpiresMinutes: Number(process.env.TWO_FACTOR_OTP_EXPIRES_MINUTES ?? 10),
  passwordResetExpiresMinutes: Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES ?? 30),

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(',').map((o) => o.trim()),
  // Used to build the clickable link in the password-reset email — falls
  // back to the first allowed CORS origin, which is the frontend URL in
  // every normal setup, so this rarely needs setting explicitly.
  frontendUrl: process.env.FRONTEND_URL ?? (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(',')[0].trim(),

  // Email (used for the registration OTP and password-reset emails) via Resend.
  // When RESEND_API_KEY is unset, emails are logged to the server console
  // instead of actually sent — fine for local dev/demo, but set a real
  // Resend API key before relying on email delivery in production.
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? 'ArbitreX <onboarding@resend.dev>',

  tradingMode: (process.env.TRADING_MODE as 'DEMO' | 'LIVE') ?? 'DEMO',
  demoStartingBalance: Number(process.env.STARTING_BALANCE ?? 0),

  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
  seedDemoEmail: process.env.SEED_DEMO_EMAIL ?? 'demo@example.com',
  seedDemoPassword: process.env.SEED_DEMO_PASSWORD ?? 'ChangeMe123!'
};
