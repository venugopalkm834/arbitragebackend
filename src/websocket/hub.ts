import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from '../config/env';
import { verifyAccessToken } from '../utils/jwt';
import { logger } from '../utils/logger';

export type WsEventName =
  | 'trade:started' | 'trade:update' | 'trade:profit' | 'trade:loss' | 'trade:closed'
  | 'wallet:update' | 'deposit:update' | 'withdrawal:update' | 'notification:new'
  | 'performance:update' | 'bot:updated';

/**
 * websocket/hub.ts
 * -----------------
 * Real Socket.IO server, matching the frontend's `socket.io-client`
 * (an earlier version of this backend used the plain `ws` library
 * because the frontend wasn't using `socket.io-client` yet at the
 * time — both sides now use Socket.IO so they actually interoperate).
 *
 * Auth: client connects with `{ auth: { token: accessToken } }`
 * (Socket.IO's built-in auth handshake payload, verified below). Each
 * socket joins a room named after its userId, so trade/wallet events
 * only reach the user they belong to. Admins additionally join an
 * `admins` room so deposit/withdrawal queue updates can broadcast to
 * every connected admin at once.
 */
class SocketHub {
  private io: SocketIOServer | null = null;

  attach(server: HttpServer): void {
    this.io = new SocketIOServer(server, {
      cors: { origin: env.corsOrigins, credentials: true }
    });

    this.io.use((socket: Socket, next) => {
      try {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) return next(new Error('Unauthorized'));
        const payload = verifyAccessToken(token);
        socket.data.userId = payload.sub;
        socket.data.role = payload.role;
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const { userId, role } = socket.data as { userId: string; role: string };
      socket.join(userId);
      if (role === 'ADMIN' || role === 'SUPER_ADMIN') socket.join('admins');
    });

    logger.info('Socket.IO hub attached');
  }

  /** Sends an event to exactly one user's active connections. */
  emitToUser(userId: string, event: WsEventName, data: unknown): void {
    this.io?.to(userId).emit(event, data);
  }

  /** Sends an event to every connected admin. */
  emitToAdmins(event: WsEventName, data: unknown): void {
    this.io?.to('admins').emit(event, data);
  }
}

export const wsHub = new SocketHub();
