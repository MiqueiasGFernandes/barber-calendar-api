import { describe, expect, it } from 'vitest';
import { IanaTimeZoneAdapter } from '../../../src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.js';

describe('IANA time zone adapter', () => {
  const zone = new IanaTimeZoneAdapter();
  it('rejects nonexistent local times and emits both instants in a repeated DST hour', () => {
    expect(zone.localDateTimeToInstants('2024-03-10T02:30:00','America/New_York')).toHaveLength(0);
    const repeated = zone.localDateTimeToInstants('2024-11-03T01:30:00','America/New_York');
    expect(repeated.map((instant) => instant.toISOString())).toEqual(['2024-11-03T05:30:00.000Z','2024-11-03T06:30:00.000Z']);
  });
  it('converts instants back to an unambiguous local representation and validates IANA zones', () => {
    expect(zone.instantToLocalDateTime(new Date('2024-11-03T05:30:00Z'),'America/New_York')).toBe('2024-11-03T01:30:00');
    expect(zone.isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
