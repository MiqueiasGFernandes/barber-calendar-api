export type AvailabilityExceptionKind = 'break' | 'time_off' | 'holiday' | 'blocked';
export class AvailabilityException {
  constructor(readonly tenantId: string, readonly professionalId: string, readonly kind: AvailabilityExceptionKind, readonly startsAt: Date, readonly endsAt: Date, readonly reason?: string) {
    if (!tenantId || !professionalId || !(startsAt instanceof Date) || !(endsAt instanceof Date) || endsAt <= startsAt) throw new Error('invalid availability exception');
    if (reason !== undefined && reason.length > 240) throw new Error('invalid availability exception reason');
  }
}
