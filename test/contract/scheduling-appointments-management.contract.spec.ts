import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  appointmentFiltersSchema,
  cancellationSchema,
  reschedulingSchema,
  outcomeSchema,
} from '../../src/modules/scheduling/infrastructure/http/dto/appointment-management.schemas.js';

const contract = parse(
  readFileSync('specs/002-appointment-scheduling/contracts/openapi.yaml', 'utf8'),
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        security: unknown[];
        parameters?: { $ref?: string; name?: string }[];
        responses: Record<string, unknown>;
      }
    >
  >;
  components: {
    schemas: Record<
      string,
      { required: string[]; additionalProperties?: boolean; properties: Record<string, unknown> }
    >;
  };
};
describe('contrato de gestão dos agendamentos', () => {
  it('declara quatro operações protegidas e idempotência nas três mutações', () => {
    for (const [suffix, method, id, statuses] of [
      ['', 'get', 'listAppointments', ['200', '401', '403', '422']],
      [
        '/{appointment_id}/cancellation',
        'post',
        'cancelAppointment',
        ['200', '401', '403', '404', '409'],
      ],
      [
        '/{appointment_id}/rescheduling',
        'post',
        'rescheduleAppointment',
        ['200', '401', '403', '404', '409', '422'],
      ],
      [
        '/{appointment_id}/outcome',
        'post',
        'recordAppointmentOutcome',
        ['200', '401', '403', '404', '409', '422'],
      ],
    ] as const) {
      const op = contract.paths[`/management/appointments${suffix}`]?.[method];
      expect(op?.operationId).toBe(id);
      expect(op?.security).toEqual([{ bearerAuth: [] }]);
      for (const status of statuses) expect(op?.responses).toHaveProperty(status);
      if (method === 'post')
        expect(op?.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' });
    }
  });
  it('valida período, filtros opcionais e comandos sem aceitar estado final arbitrário ou tenant', () => {
    const range = {
      starts_from: '2030-01-07T09:00:00-03:00',
      ends_before: '2030-01-07T18:00:00-03:00',
    };
    expect(appointmentFiltersSchema.safeParse(range).success).toBe(true);
    for (const status of ['confirmed', 'cancelled', 'attended', 'no_show'])
      expect(appointmentFiltersSchema.safeParse({ ...range, status }).success).toBe(true);
    for (const value of [
      { ...range, tenant_id: 'tenant' },
      { ...range, status: 'pending' },
      { ...range, professional_id: 'nope' },
      { ...range, ends_before: range.starts_from },
      { ...range, starts_from: '2030-01-07' },
    ])
      expect(appointmentFiltersSchema.safeParse(value).success).toBe(false);
    expect(cancellationSchema.safeParse({ tenant_id: 'tenant' }).success).toBe(false);
    expect(reschedulingSchema.safeParse({ starts_at: range.starts_from }).success).toBe(true);
    expect(
      reschedulingSchema.safeParse({ starts_at: range.starts_from, professional_id: 'other' })
        .success,
    ).toBe(false);
    expect(outcomeSchema.safeParse({ status: 'attended' }).success).toBe(true);
    expect(outcomeSchema.safeParse({ status: 'no_show' }).success).toBe(true);
    for (const status of ['confirmed', 'cancelled', 'pending'])
      expect(outcomeSchema.safeParse({ status }).success).toBe(false);
  });
  it('limita o resultado administrativo aos campos do contrato e mantém contatos obrigatórios', () => {
    const schema = contract.components.schemas.ManagedAppointment;
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.required).toEqual([
      'id',
      'status',
      'service_id',
      'service_name',
      'professional_id',
      'professional_name',
      'starts_at',
      'ends_at',
      'guest_name',
      'guest_phone',
      'guest_email',
    ]);
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(
      [...(schema?.required ?? [])].sort(),
    );
  });
});
