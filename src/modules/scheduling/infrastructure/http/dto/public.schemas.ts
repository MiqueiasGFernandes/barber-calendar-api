import { z } from 'zod';

export const tenantSlugSchema=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const availabilityQuerySchema=z.object({service_id:z.uuid(),date:z.iso.date(),professional_id:z.uuid().optional()}).strict();
export const guestAppointmentSchema=z.object({
  service_id:z.uuid(),professional_id:z.uuid().nullable().optional(),starts_at:z.iso.datetime({offset:true}),
  guest_name:z.string().trim().min(1).max(160),guest_phone:z.string().regex(/^\+[1-9]\d{7,14}$/),guest_email:z.email().max(254),
}).strict();
