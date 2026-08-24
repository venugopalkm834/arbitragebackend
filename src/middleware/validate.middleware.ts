import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../utils/ApiError';

/** Validates req.body against a Zod schema; 422 with field-level details on failure (spec §33/§41/§54). */
export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(ApiError.unprocessable('Validation failed.', result.error.flatten().fieldErrors));
    }
    req.body = result.data;
    next();
  };
}
