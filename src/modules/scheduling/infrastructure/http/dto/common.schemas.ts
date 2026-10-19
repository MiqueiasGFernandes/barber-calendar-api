import { z } from 'zod';
import { ApplicationError } from '../../../../../shared/application/application-error.js';

export const uuidSchema = z.uuid();
export const idempotencyKeySchema = z.string().min(16).max(128);
export const instantSchema = z.iso.datetime({ offset: true });
export const dateSchema = z.iso.date();
export function parseSchedulingInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApplicationError(422, 'validation_error', 'Invalid request');
  return parsed.data;
}
export function requireIdempotencyKey(value: unknown): string {
  return parseSchedulingInput(idempotencyKeySchema, value);
}
