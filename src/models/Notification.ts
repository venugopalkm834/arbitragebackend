import { Schema, model, Document, Types } from 'mongoose';

export type NotificationType =
  | 'TRADE_STARTED' | 'TRADE_PROFIT' | 'TRADE_LOSS' | 'TAKE_PROFIT_TRIGGERED'
  | 'STOP_LOSS_TRIGGERED' | 'DEPOSIT_APPROVED' | 'WITHDRAWAL_APPROVED'
  | 'WITHDRAWAL_REJECTED' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT';

export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  message: string;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['TRADE_STARTED', 'TRADE_PROFIT', 'TRADE_LOSS', 'TAKE_PROFIT_TRIGGERED', 'STOP_LOSS_TRIGGERED', 'DEPOSIT_APPROVED', 'WITHDRAWAL_APPROVED', 'WITHDRAWAL_REJECTED', 'ADMIN_CREDIT', 'ADMIN_DEBIT'],
      required: true
    },
    message: { type: String, required: true },
    read: { type: Boolean, default: false }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Notification = model<INotification>('Notification', notificationSchema);
