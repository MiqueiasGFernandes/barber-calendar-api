import { describe, expect, it } from 'vitest';
import { Service } from '../../../src/modules/scheduling/domain/service.js';
import { Professional } from '../../../src/modules/scheduling/domain/professional.js';
import { validateWeeklyWorkPeriods } from '../../../src/modules/scheduling/domain/work-period.js';
import { AvailabilityException } from '../../../src/modules/scheduling/domain/availability-exception.js';
import { SchedulingSettings } from '../../../src/modules/scheduling/domain/scheduling-settings.js';

describe('scheduling configuration models', () => {
  it('validates and trims services/professionals while preserving independent snapshots', () => {
    const service = new Service('s','t',{ name:' Corte ', durationMinutes:30, priceMinor:0, currency:'BRL' });
    const professional = new Professional('p','t',' Barber ');
    expect(service.name).toBe('Corte'); expect(service.status).toBe('active'); expect(professional.displayName).toBe('Barber');
    expect(() => new Service('s','t',{ name:' ',durationMinutes:481,priceMinor:-1,currency:'brl' })).toThrow();
    expect(() => new Service('s','t',{ name:'a'.repeat(121),durationMinutes:30,priceMinor:0,currency:'BRL' })).toThrow();
    expect(() => new Service('s','t',{ name:'Corte',description:'x'.repeat(1001),durationMinutes:30,priceMinor:0,currency:'BRL' })).toThrow();
    expect(() => new Service('s','t',{ name:'Corte',durationMinutes:0,priceMinor:0,currency:'BRL' })).toThrow();
    expect(() => new Service('s','t',{ name:'Corte',durationMinutes:30,priceMinor:0,currency:'BRL',status:'deleted' as never })).toThrow();
    expect(() => new Professional('p','t','x'.repeat(121))).toThrow();
  });
  it('uses 15/30 defaults, permits zero advance, and rejects invalid configuration', () => {
    expect(new SchedulingSettings()).toMatchObject({ slotIntervalMinutes:15, minimumAdvanceMinutes:30 });
    expect(new SchedulingSettings(20,0).minimumAdvanceMinutes).toBe(0);
    expect(() => new SchedulingSettings(0,0)).toThrow(); expect(() => new SchedulingSettings(15,-1)).toThrow();
  });
  it('rejects overlapping or invalid weekly periods and keeps pauses as separate periods', () => {
    const valid = [{ isoWeekday:1, startsLocalTime:'09:00:00', endsLocalTime:'12:00:00' },{ isoWeekday:1, startsLocalTime:'13:00:00', endsLocalTime:'18:00:00' }];
    expect(() => validateWeeklyWorkPeriods(valid)).not.toThrow();
    expect(() => validateWeeklyWorkPeriods([...valid,{ isoWeekday:1, startsLocalTime:'11:00:00', endsLocalTime:'14:00:00' }])).toThrow();
    expect(() => validateWeeklyWorkPeriods([{ isoWeekday:8, startsLocalTime:'22:00:00', endsLocalTime:'01:00:00' }])).toThrow();
    expect(() => validateWeeklyWorkPeriods([{ isoWeekday:1, startsLocalTime:'09:00:00', endsLocalTime:'09:00:00' }])).toThrow();
    expect(() => validateWeeklyWorkPeriods([{ isoWeekday:1, startsLocalTime:'23:00:00', endsLocalTime:'01:00:00' }])).toThrow();
    expect(() => validateWeeklyWorkPeriods([{ isoWeekday:1, startsLocalTime:'09:00', endsLocalTime:'10:00:00' }])).toThrow();
  });
  it('requires valid exception intervals without introducing working hours', () => {
    expect(() => new AvailabilityException('t','p','break',new Date('2030-01-01T11:00Z'),new Date('2030-01-01T10:00Z'))).toThrow();
    expect(() => new AvailabilityException('t','p','unexpected' as never,new Date('2030-01-01T10:00Z'),new Date('2030-01-01T11:00Z'))).toThrow();
    expect(() => new AvailabilityException('t','p','break',new Date('2030-01-01T10:00Z'),new Date('2030-01-01T11:00Z'),'x'.repeat(241))).toThrow();
    expect(new AvailabilityException('t','p','holiday',new Date('2030-01-01T10:00Z'),new Date('2030-01-01T11:00Z')).kind).toBe('holiday');
  });
});
