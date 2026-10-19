import { describe, expect, it } from 'vitest';
import { availableSlots } from '../../../src/modules/scheduling/domain/availability.js';
import { IanaTimeZoneAdapter } from '../../../src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.js';
const converter = new IanaTimeZoneAdapter();
const utcNow = new Date('2030-01-07T08:30:00Z');
const pro = (id: string, period = { startsAt: '09:07:00', endsAt: '11:00:00' }) => ({
  id,
  periods: [period],
  exceptions: [],
  appointments: [],
});
describe('availability', () => {
  it('anchors configurable 15/20 minute grids at each period and fits full duration', () => {
    const slots = availableSlots({
      date: '2030-01-07',
      now: utcNow,
      timeZone: 'UTC',
      slotIntervalMinutes: 20,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals: [pro('p')],
      converter,
    });
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2030-01-07T09:07:00.000Z',
      '2030-01-07T09:27:00.000Z',
      '2030-01-07T09:47:00.000Z',
      '2030-01-07T10:07:00.000Z',
      '2030-01-07T10:27:00.000Z',
    ]);
  });
  it('allows adjacent intervals but excludes pauses and overlapping appointments', () => {
    const professional = {
      ...pro('p', { startsAt: '09:00:00', endsAt: '11:00:00' }),
      exceptions: [
        { startsAt: new Date('2030-01-07T10:00:00Z'), endsAt: new Date('2030-01-07T10:30:00Z') },
      ],
      appointments: [
        { startsAt: new Date('2030-01-07T09:30:00Z'), endsAt: new Date('2030-01-07T10:00:00Z') },
      ],
    };
    const slots = availableSlots({
      date: '2030-01-07',
      now: utcNow,
      timeZone: 'UTC',
      slotIntervalMinutes: 30,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals: [professional],
      converter,
    });
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2030-01-07T09:00:00.000Z',
      '2030-01-07T10:30:00.000Z',
    ]);
  });
  it('applies inclusive configured advance and strict future-only zero, within today through day 30', () => {
    const period = { startsAt: '09:00:00', endsAt: '10:00:00' };
    const atLiminal = availableSlots({
      date: '2030-01-07',
      now: new Date('2030-01-07T08:30:00Z'),
      timeZone: 'UTC',
      slotIntervalMinutes: 15,
      minimumAdvanceMinutes: 30,
      durationMinutes: 15,
      professionals: [pro('p', period)],
      converter,
    });
    expect(atLiminal[0]?.startsAt.toISOString()).toBe('2030-01-07T09:00:00.000Z');
    const zero = availableSlots({
      date: '2030-01-07',
      now: new Date('2030-01-07T09:00:00Z'),
      timeZone: 'UTC',
      slotIntervalMinutes: 15,
      minimumAdvanceMinutes: 0,
      durationMinutes: 15,
      professionals: [pro('p', period)],
      converter,
    });
    expect(zero[0]?.startsAt.toISOString()).toBe('2030-01-07T09:15:00.000Z');
    const base = {
      now: utcNow,
      timeZone: 'UTC',
      slotIntervalMinutes: 15,
      minimumAdvanceMinutes: 0,
      durationMinutes: 15,
      professionals: [pro('p', period)],
      converter,
    };
    expect(availableSlots({ ...base, date: '2030-01-06' })).toHaveLength(0);
    expect(availableSlots({ ...base, date: '2030-02-06' })).toHaveLength(4);
    expect(availableSlots({ ...base, date: '2030-02-07' })).toHaveLength(0);
  });
  it('honors explicit professional and balances any-professional by confirmed minutes then UUID', () => {
    const professionals = [
      {
        ...pro('b', { startsAt: '09:00:00', endsAt: '10:00:00' }),
        appointments: [
          { startsAt: new Date('2030-01-07T08:00:00Z'), endsAt: new Date('2030-01-07T08:45:00Z') },
        ],
      },
      pro('a', { startsAt: '09:00:00', endsAt: '10:00:00' }),
    ];
    const result = availableSlots({
      date: '2030-01-07',
      now: utcNow,
      timeZone: 'UTC',
      slotIntervalMinutes: 30,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals,
      converter,
    });
    expect(result[0]?.professionalId).toBe('a');
    const explicit = availableSlots({
      date: '2030-01-07',
      now: utcNow,
      timeZone: 'UTC',
      slotIntervalMinutes: 30,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals,
      converter,
      selectedProfessionalId: 'b',
    });
    expect(explicit[0]?.professionalId).toBe('b');
  });
  it('restarts each period grid at its own start and permits shared boundaries', () => {
    const periods = [
      { startsAt: '09:00:00', endsAt: '09:30:00' },
      { startsAt: '10:00:00', endsAt: '10:30:00' },
    ];
    const slots = availableSlots({
      date: '2030-01-07',
      now: utcNow,
      timeZone: 'UTC',
      slotIntervalMinutes: 20,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals: [
        {
          ...pro('p'),
          periods,
          appointments: [
            {
              startsAt: new Date('2030-01-07T09:30:00Z'),
              endsAt: new Date('2030-01-07T10:00:00Z'),
            },
          ],
        },
      ],
      converter,
    });
    expect(slots.map(({ startsAt }) => startsAt.toISOString())).toEqual([
      '2030-01-07T09:00:00.000Z',
      '2030-01-07T10:00:00.000Z',
    ]);
  });
  it('breaks equal daily workloads by the smallest professional UUID', () => {
    const slots = availableSlots({
      date: '2030-01-07',
      now: utcNow,
      timeZone: 'UTC',
      slotIntervalMinutes: 30,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals: [
        pro('b', { startsAt: '09:00:00', endsAt: '10:00:00' }),
        pro('a', { startsAt: '09:00:00', endsAt: '10:00:00' }),
      ],
      converter,
    });
    expect(slots[0]?.professionalId).toBe('a');
  });
  it('preserva o intervalo válido antes de um fechamento que cai na lacuna civil', () => {
    const slots = availableSlots({
      date: '2024-03-10',
      now: new Date('2024-03-09T12:00:00Z'),
      timeZone: 'America/New_York',
      slotIntervalMinutes: 30,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals: [pro('p', { startsAt: '01:00:00', endsAt: '02:30:00' })],
      converter,
    });
    expect(
      slots.map((slot) => converter.instantToOffsetDateTime(slot.startsAt, 'America/New_York')),
    ).toEqual(['2024-03-10T01:00:00-05:00']);
    const first = slots[0];
    if (!first) throw new Error('Missing valid slot');
    expect(converter.instantToOffsetDateTime(first.endsAt, 'America/New_York')).toBe(
      '2024-03-10T01:30:00-05:00',
    );
  });
  it('mantém grade e duração decorrida quando a abertura é inexistente e o fechamento é válido', () => {
    const slots = availableSlots({
      date: '2024-03-10',
      now: new Date('2024-03-09T12:00:00Z'),
      timeZone: 'America/New_York',
      slotIntervalMinutes: 30,
      minimumAdvanceMinutes: 0,
      durationMinutes: 30,
      professionals: [pro('p', { startsAt: '02:30:00', endsAt: '04:00:00' })],
      converter,
    });
    expect(
      slots.map((slot) => converter.instantToOffsetDateTime(slot.startsAt, 'America/New_York')),
    ).toEqual(['2024-03-10T03:00:00-04:00', '2024-03-10T03:30:00-04:00']);
    expect(slots.every((slot) => slot.endsAt.getTime() - slot.startsAt.getTime() === 1800000)).toBe(
      true,
    );
  });
});
