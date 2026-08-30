import path from 'path';
import compression from 'compression';
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';
import { apiRateLimiter } from './middleware/rateLimit.middleware';
import routes from './routes';
export function createApp(): Express {
  const app = express();

  // spec §41: Helmet, CORS, request validation, rate limiting.
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.isProd ? 'combined' : 'dev'));
  app.use('/api', apiRateLimiter);

  // Uploaded deposit receipts (spec §16 addition) — served as static files so
  // both the user who uploaded one and admins reviewing deposits can view it
  // directly by URL. Helmet's default Cross-Origin-Resource-Policy would
  // otherwise block the Angular dev server (a different origin/port) from
  // loading these as <img> sources, so it's relaxed for this path only.
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static(path.join(__dirname, '..', 'uploads'))
  );

  app.use('/api', routes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
