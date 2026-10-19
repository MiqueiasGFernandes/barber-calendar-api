export type AppointmentStatus = 'confirmed' | 'cancelled' | 'attended' | 'no_show';
export interface AppointmentInput {
  id: string; publicId: string; tenantId: string; professionalId: string; serviceId: string;
  startsAt: Date; endsAt: Date; customerName: string; customerPhone: string; customerEmail: string;
  serviceName: string; durationMinutes: number; priceMinor: number; currency: string;
}
export class Appointment {
  private currentStatus: AppointmentStatus = 'confirmed';
  private currentStartsAt: Date;
  private currentEndsAt: Date;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string;
  constructor(readonly input: AppointmentInput) {
    if (!input.id || !input.publicId || !input.tenantId || !input.professionalId || !input.serviceId) throw new Error('invalid appointment identifiers');
    if (!(input.startsAt instanceof Date) || !(input.endsAt instanceof Date) || input.endsAt <= input.startsAt) throw new Error('appointment end must be after start');
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || (input.endsAt.getTime()-input.startsAt.getTime()) !== input.durationMinutes*60_000) throw new Error('appointment duration mismatch');
    if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0 || !/^[A-Z]{3}$/.test(input.currency)) throw new Error('invalid service snapshot');
    this.customerName = input.customerName.trim();
    this.customerPhone = input.customerPhone.replace(/[\s()-]/g,'');
    this.customerEmail = input.customerEmail.trim().toLowerCase();
    if (this.customerName.length < 1 || this.customerName.length > 160) throw new Error('invalid customer name');
    if (!/^\+[1-9]\d{7,14}$/.test(this.customerPhone)) throw new Error('invalid E.164 phone');
    if (this.customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.customerEmail)) throw new Error('invalid email');
    this.currentStartsAt = new Date(input.startsAt);
    this.currentEndsAt = new Date(input.endsAt);
  }
  get status(): AppointmentStatus { return this.currentStatus; }
  get startsAt(): Date { return new Date(this.currentStartsAt); }
  get endsAt(): Date { return new Date(this.currentEndsAt); }
  cancel(): void { this.requireConfirmed(); this.currentStatus = 'cancelled'; }
  reschedule(startsAt: Date, endsAt: Date): void {
    this.requireConfirmed();
    if (!(startsAt instanceof Date) || !(endsAt instanceof Date) || endsAt <= startsAt || endsAt.getTime()-startsAt.getTime() !== this.input.durationMinutes*60_000) throw new Error('invalid appointment interval');
    this.currentStartsAt = new Date(startsAt); this.currentEndsAt = new Date(endsAt);
  }
  recordOutcome(outcome: 'attended' | 'no_show', now: Date): void {
    this.requireConfirmed();
    const threshold = outcome === 'attended' ? this.currentEndsAt : this.currentStartsAt;
    if (now < threshold) throw new Error('appointment outcome is premature');
    this.currentStatus = outcome;
  }
  private requireConfirmed(): void { if (this.currentStatus !== 'confirmed') throw new Error('appointment is final'); }
}
