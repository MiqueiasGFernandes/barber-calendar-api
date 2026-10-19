export class SchedulingSettings {
  constructor(readonly slotIntervalMinutes = 15, readonly minimumAdvanceMinutes = 30, readonly timeZone = 'America/Sao_Paulo') {
    if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes < 1) throw new Error('slot interval must be positive');
    if (!Number.isInteger(minimumAdvanceMinutes) || minimumAdvanceMinutes < 0) throw new Error('minimum advance cannot be negative');
    try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); } catch { throw new Error('invalid IANA time zone'); }
  }
}
