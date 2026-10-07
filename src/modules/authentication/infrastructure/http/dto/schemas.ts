import { z } from 'zod';
export const registrationSchema = z
  .object({
    tenant_name: z.string().trim().min(1).max(160),
    tenant_slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    administrator_email: z.email().max(254),
  })
  .strict();
export const otpRequestSchema = z
  .object({
    tenant_slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    email: z.email().max(254),
  })
  .strict();
export const otpVerificationSchema = z
  .object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();
