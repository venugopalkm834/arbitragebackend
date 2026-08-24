import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../utils/jwt';
import { User, UserRole } from '../models/User';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  fullName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/** Verifies the bearer JWT and attaches { id, role } to req.user. Never trusts anything the client claims beyond the signed token. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing or malformed Authorization header.');
    }
    const token = header.slice('Bearer '.length);
    const payload = verifyAccessToken(token);

    // Confirm the user still exists and isn't blocked — a valid JWT alone
    // isn't enough if an admin blocked the account after it was issued.
    const user = await User.findById(payload.sub).select('status role fullName');
    if (!user || user.status === 'BLOCKED') {
      throw ApiError.unauthorized('Account is not active.');
    }

    req.user = { id: payload.sub, role: payload.role, fullName: user.fullName };
    next();
  } catch (err) {
    next(ApiError.unauthorized('Invalid or expired access token.'));
  }
}

/** Role guard — spec §39: protect all admin endpoints with ADMIN / SUPER_ADMIN. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden('Insufficient permissions.'));
    next();
  };
}
