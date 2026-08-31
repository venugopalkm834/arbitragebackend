import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';
import { logger } from './utils/logger';
import { wsHub } from './websocket/hub';
import { startScheduler, stopScheduler } from './services/botScheduler.service';
import { logEmailConfigStatus } from './utils/email';

async function main(): Promise<void> {
  //await connectDatabase();
try{
  await connectDatabase();
  logger.info('Database connection established successfully');
}catch (error) {
  logger.error('Error connecting to the database:', error);
  process.exit(1); // Exit the process with an error code
}
  // Surface SMTP misconfiguration immediately at boot (e.g. "OTP not
  // arriving by email") instead of only discovering it on a user's first
  // login attempt.
  logEmailConfigStatus();

  const app = createApp();
  const server = http.createServer(app);

  // Same HTTP server handles both REST and the WebSocket upgrade — the
  // frontend connects to the same host/port it hits for REST calls.
  wsHub.attach(server);

  // Backend-owned simulation engine (spec §2-5/§23) — queries ACTIVE
  // BotSessions from the DB every tick, so it "resumes" automatically
  // after a restart with no separate recovery step needed.
  startScheduler();

  server.listen(env.port,'0.0.0.0', () => {
    logger.info(`ArbitreX backend listening on port ${env.port} (${env.nodeEnv}, TRADING_MODE=${env.tradingMode})`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    stopScheduler();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal error during startup', err);
  process.exit(1);
});
