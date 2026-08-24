import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Request } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * upload.middleware.ts
 * ---------------------
 * Handles the deposit-receipt upload (spec §16 addition: user attaches
 * proof of payment — a screenshot/photo of the transfer — when creating
 * a deposit request, which admins can then review before approving).
 *
 * Files are written to backend/uploads/receipts/ (created on first run
 * if missing) and served back statically from /uploads (see app.ts).
 * Each file gets a random name to avoid collisions and to not leak the
 * original filename.
 */

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const RECEIPTS_DIR = path.join(UPLOAD_ROOT, 'receipts');

fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECEIPTS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) ? ext : '';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, unique);
  }
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(ApiError.unprocessable('Receipt must be a JPG, PNG, WEBP image or a PDF.'));
    return;
  }
  cb(null, true);
}

const uploader = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

/** Single optional file field named "receipt" — deposits can still be created without one. */
export const uploadReceipt = uploader.single('receipt');

/** Public URL path for an uploaded receipt file, to store on the Deposit document. */
export function receiptUrlFor(filename: string): string {
  return `/uploads/receipts/${filename}`;
}
