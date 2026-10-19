import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { availabilityQuerySchema, guestAppointmentSchema, tenantSlugSchema } from '../../src/modules/scheduling/infrastructure/http/dto/public.schemas.js';

const contract = parse(readFileSync('specs/002-appointment-scheduling/contracts/openapi.yaml', 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
  components: { schemas: Record<string, { required?: string[]; additionalProperties?: boolean }> };
};

describe('contrato público de agendamentos', () => {
  it('expõe as três operações públicas e os status documentados', () => {
    const operations = [
      ['/public/tenants/{tenant_slug}/services', 'get', 'listPublicServices', ['200', '404', '429']],
      ['/public/tenants/{tenant_slug}/availability', 'get', 'getPublicAvailability', ['200', '404', '422', '429']],
      ['/public/tenants/{tenant_slug}/appointments', 'post', 'createGuestAppointment', ['201', '404', '409', '422', '429']],
    ] as const;
    for (const [path, method, operationId, statuses] of operations) {
      const operation = contract.paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      for (const status of statuses) expect(operation?.responses).toHaveProperty(status);
    }
  });

  it('valida slug, data, serviço, profissional e os três contatos obrigatórios', () => {
    expect(tenantSlugSchema.safeParse('barbearia-centro').success).toBe(true);
    expect(tenantSlugSchema.safeParse('../outro-tenant').success).toBe(false);
    expect(availabilityQuerySchema.safeParse({ service_id: '10000000-0000-4000-8000-000000000001', date: '2030-01-07' }).success).toBe(true);
    expect(availabilityQuerySchema.safeParse({ service_id: 'nope', date: '2030-02-30' }).success).toBe(false);
    const valid = { service_id: '10000000-0000-4000-8000-000000000001', starts_at: '2030-01-07T12:00:00-03:00', guest_name: 'Cliente', guest_phone: '+5511999999999', guest_email: 'cliente@example.test' };
    expect(guestAppointmentSchema.safeParse(valid).success).toBe(true);
    for (const key of ['guest_name', 'guest_phone', 'guest_email']) {
      expect(guestAppointmentSchema.safeParse({ ...valid, [key]: undefined }).success).toBe(false);
    }
    expect(guestAppointmentSchema.safeParse({ ...valid, email: 'other@example.test' }).success).toBe(false);
    expect(guestAppointmentSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
  });

  it('mantém os schemas de respostas públicas sem campos de contato', () => {
    expect(contract.components.schemas.PublicService?.additionalProperties).toBe(false);
    expect(contract.components.schemas.AvailableSlot?.additionalProperties).toBe(false);
    expect(contract.components.schemas.GuestAppointmentResponse?.required).toEqual(['id', 'status', 'service_name', 'professional_name', 'starts_at', 'ends_at']);
    for (const schemaName of ['PublicService', 'AvailableSlot', 'GuestAppointmentResponse']) {
      expect(contract.components.schemas[schemaName]?.required).not.toContain('guest_email');
      expect(contract.components.schemas[schemaName]?.required).not.toContain('guest_phone');
    }
  });
});
