import { Schema, model, Document } from 'mongoose';

export interface ICounter extends Document {
  name: string; // e.g. 'trade_ticket'
  value: number;
}

/**
 * Generic atomic counter, backing sequence generators like trade ticket
 * numbers. Using a DB-backed counter (instead of an in-memory `let`
 * variable) means the sequence survives server restarts and stays unique
 * across multiple backend instances — an in-memory counter resets to its
 * initial value on every restart, which will eventually collide with an
 * already-used ticket number and throw a duplicate-key error.
 */
const counterSchema = new Schema<ICounter>({
  name: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 }
});

export const Counter = model<ICounter>('Counter', counterSchema);
