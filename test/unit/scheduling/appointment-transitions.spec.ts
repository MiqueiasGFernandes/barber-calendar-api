import { describe, expect, it } from 'vitest';
import { Appointment } from '../../../src/modules/scheduling/domain/appointment.js';

function appointment() {
  return new Appointment({
    id: 'a',
    publicId: 'p',
    tenantId: 't',
    professionalId: 'pr',
    serviceId: 's',
    startsAt: new Date('2030-01-01T10:00:00Z'),
    endsAt: new Date('2030-01-01T10:30:00Z'),
    customerName: ' Cliente ',
    customerPhone: '+55 (11) 99999-9999',
    customerEmail: 'CLIENT@EXAMPLE.TEST',
    serviceName: 'Corte',
    durationMinutes: 30,
    priceMinor: 5000,
    currency: 'BRL',
  });
}
describe('appointment transitions', () => {
  it.each(['cancelled', 'attended', 'no_show'] as const)(
    'keeps %s terminal for every subsequent command',
    (status) => {
      const item = appointment();
      if (status === 'cancelled') item.cancel();
      else item.recordOutcome(status, new Date('2030-01-01T10:30:00Z'));
      expect(item.status).toBe(status);
      expect(() => item.cancel()).toThrow();
      expect(() =>
        item.reschedule(new Date('2030-01-02T10:00Z'), new Date('2030-01-02T10:30Z')),
      ).toThrow();
      for (const outcome of ['attended', 'no_show'] as const)
        expect(() => item.recordOutcome(outcome, new Date('2030-01-03T10:00Z'))).toThrow();
      expect(item.status).toBe(status);
    },
  );
  it('rejects invalid outcomes and clocks without changing state', () => {
    const item = appointment();
    expect(() => item.recordOutcome('confirmed' as never, new Date('2030-01-03T10:00Z'))).toThrow();
    expect(() => item.recordOutcome('attended', new Date('invalid'))).toThrow();
    expect(item.status).toBe('confirmed');
  });
  it('preserves service, professional and price snapshots when rescheduling, and returns defensive dates', () => {
    const item = appointment();
    const snapshot = { ...item.input };
    item.reschedule(new Date('2030-01-02T10:00Z'), new Date('2030-01-02T10:30Z'));
    item.startsAt.setUTCFullYear(2000);
    expect(item.input).toEqual(snapshot);
    expect(item.startsAt.toISOString()).toBe('2030-01-02T10:00:00.000Z');
    expect(() => item.reschedule(new Date('invalid'), new Date('invalid'))).toThrow();
    expect(item.startsAt.toISOString()).toBe('2030-01-02T10:00:00.000Z');
  });
  it('normalizes guest contacts, starts confirmed, and reschedules only a confirmed appointment preserving duration', () => {
    const item = appointment();
    expect(item.status).toBe('confirmed');
    expect(item.customerName).toBe('Cliente');
    expect(item.customerPhone).toBe('+5511999999999');
    expect(item.customerEmail).toBe('client@example.test');
    item.reschedule(new Date('2030-01-02T10:00:00Z'), new Date('2030-01-02T10:30:00Z'));
    expect(item.startsAt.toISOString()).toBe('2030-01-02T10:00:00.000Z');
  });
  it('allows no_show from start and attended after end, while final states cannot reopen', () => {
    const early = appointment();
    expect(() => early.recordOutcome('no_show', new Date('2030-01-01T09:59:59Z'))).toThrow();
    early.recordOutcome('no_show', new Date('2030-01-01T10:00:00Z'));
    expect(() => early.cancel()).toThrow();
    expect(() => early.reschedule(new Date(), new Date(Date.now() + 1))).toThrow();
    const attended = appointment();
    expect(() => attended.recordOutcome('attended', new Date('2030-01-01T10:29:59Z'))).toThrow();
    attended.recordOutcome('attended', new Date('2030-01-01T10:30:00Z'));
  });
  it('preserves the old interval when a proposed interval is invalid', () => {
    const item = appointment();
    const previous = item.startsAt;
    expect(() =>
      item.reschedule(new Date('2030-01-02T10:00:00Z'), new Date('2030-01-02T10:20:00Z')),
    ).toThrow();
    expect(item.startsAt).toEqual(previous);
  });
});
