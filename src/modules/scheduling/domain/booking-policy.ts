export interface BookingRules {
  now: Date; startsAt: Date; endsAt: Date; slotIntervalMinutes: number; minimumAdvanceMinutes: number;
  durationMinutes: number; periodStart: Date; periodEnd: Date;
}
export function isBookingAllowed(rules: BookingRules): boolean {
  const start = rules.startsAt.getTime(); const end = rules.endsAt.getTime(); const now = rules.now.getTime();
  if (![start,end,now].every(Number.isFinite) || end <= start || end-start !== rules.durationMinutes*60_000) return false;
  if (rules.minimumAdvanceMinutes < 0 || rules.slotIntervalMinutes < 1 || !Number.isInteger(rules.slotIntervalMinutes)) return false;
  if (start < rules.periodStart.getTime() || end > rules.periodEnd.getTime()) return false;
  const earliest = rules.minimumAdvanceMinutes === 0 ? now + 1 : now + rules.minimumAdvanceMinutes*60_000;
  return start >= earliest;
}
