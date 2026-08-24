import { z } from 'zod';

export const depositSchema = z.object({
  // z.coerce handles both a JSON number and a multipart/form-data string
  // (multer parses non-file fields as strings) — the deposit form now
  // submits as multipart when a receipt file is attached.
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  currency: z.string().min(1),
  network: z.string().min(1),
  walletAddress: z.string().min(1)
});

export const withdrawalSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  currency: z.string().min(1),
  network: z.string().min(1),
  walletAddress: z.string().min(1, 'Destination wallet address is required')
});
