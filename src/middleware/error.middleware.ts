import { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

/** Centralized error handling — spec §33/§41. Never exposes stack traces or raw internals to the client. */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ message: err.message, details: err.details });
    return;
  }

  // File upload errors (receipt upload — too large, unexpected field, etc.)
  if (err instanceof MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Receipt file is too large (max 5MB).' : `Upload error: ${err.message}`;
    res.status(422).json({ message });
    return;
  }

  // Mongoose duplicate key error
  if (isDuplicateKeyError(err)) {
    res.status(409).json({ message: 'A record with these details already exists.' });
    return;
  }

  logger.error('Unhandled error', err);
  res.status(500).json({ message: 'Something went wrong on our end. Please try again.' });
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export function notFoundMiddleware(_req: Request, res: Response): void {
  res.status(404).json({ message: 'The requested resource could not be found.' });
}
