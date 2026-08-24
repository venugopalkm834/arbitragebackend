import { Types } from 'mongoose';
import { Notification, NotificationType } from '../models/Notification';
import { wsHub } from '../websocket/hub';

/** Creates a notification row AND pushes it live over WS to that user — mirrors spec §43. */
export async function pushNotification(
  userId: Types.ObjectId | string,
  type: NotificationType,
  message: string
): Promise<void> {
  const notification = await Notification.create({ userId, type, message });
  wsHub.emitToUser(userId.toString(), 'notification:new', {
    id: notification._id.toString(),
    type: notification.type,
    message: notification.message,
    read: notification.read,
    createdAt: notification.createdAt
  });
}
