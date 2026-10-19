import type { TimeZoneConverter } from '../../application/ports/time-zone.js';

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function partsAt(instant: Date, timeZone: string): Parts {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const item = (key: Intl.DateTimeFormatPartTypes) => Number(values.find((part) => part.type === key)?.value);
  return { year: item('year'), month: item('month'), day: item('day'), hour: item('hour'), minute: item('minute'), second: item('second') };
}
function parseLocal(value: string): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new RangeError('invalid local date-time');
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match.slice(1).map((part) => Number(part ?? 0));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new RangeError('invalid local date-time');
  return { year, month, day, hour, minute, second };
}
const wallMilliseconds = (p: Parts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
const key = (p: Parts) => `${String(p.year).padStart(4,'0')}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}`;

export class IanaTimeZoneAdapter implements TimeZoneConverter {
  isValidTimeZone(timeZone: string): boolean {
    try { new Intl.DateTimeFormat('en-US', { timeZone }); return true; } catch { return false; }
  }
  localDateTimeToInstants(localDateTime: string, timeZone: string): Date[] {
    if (!this.isValidTimeZone(timeZone)) throw new RangeError('invalid IANA time zone');
    const desired = parseLocal(localDateTime); const wall = wallMilliseconds(desired); const offsets = new Set<number>();
    for (let delta = -36; delta <= 36; delta += 3) {
      const sample = new Date(wall + delta * 3_600_000);
      offsets.add(wallMilliseconds(partsAt(sample, timeZone)) - sample.getTime());
    }
    return [...offsets].map((offset) => new Date(wall - offset)).filter((candidate) => key(partsAt(candidate, timeZone)) === key(desired)).sort((a,b) => a.getTime()-b.getTime());
  }
  instantToLocalDateTime(instant: Date, timeZone: string): string {
    if (Number.isNaN(instant.getTime()) || !this.isValidTimeZone(timeZone)) throw new RangeError('invalid instant or IANA time zone');
    return key(partsAt(instant, timeZone));
  }
}
