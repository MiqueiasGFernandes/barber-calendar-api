import { z } from 'zod';
import { instantSchema, uuidSchema } from './common.schemas.js';

export const appointmentFiltersSchema = z
  .object({
    starts_from: instantSchema,
    ends_before: instantSchema,
    professional_id: uuidSchema.optional(),
    status: z.enum(['confirmed', 'cancelled', 'attended', 'no_show']).optional(),
  })
  .strict()
  .refine((value) => Date.parse(value.ends_before) > Date.parse(value.starts_from));
export const cancellationSchema = z.object({}).strict().default({});
export const reschedulingSchema = z.object({ starts_at: instantSchema }).strict();
export const outcomeSchema = z.object({ status: z.enum(['attended', 'no_show']) }).strict();
