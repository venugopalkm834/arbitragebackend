import { Schema, model, Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  adminName: string;
  action: string;
  targetUserId?: Types.ObjectId;
  targetResource?: string;
  resourceId?: string;
  oldValue?: string;
  newValue?: string;
  ipAddress: string;
  createdAt: Date;
}

/** Every sensitive admin action writes one of these — spec §48. Append-only, never edited. */
const auditLogSchema = new Schema<IAuditLog>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    adminName: { type: String, required: true },
    action: { type: String, required: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    targetResource: { type: String },
    resourceId: { type: String },
    oldValue: { type: String },
    newValue: { type: String },
    ipAddress: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
