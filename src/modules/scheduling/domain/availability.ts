export interface TimeZoneConverter {
  localDateTimeToInstants(localDateTime: string, timeZone: string): Date[];
  instantToLocalDateTime(instant: Date, timeZone: string): string;
  instantToOffsetDateTime(instant: Date, timeZone: string): string;
  isValidTimeZone(timeZone: string): boolean;
}

export interface WorkPeriod {
  startsAt: string;
  endsAt: string;
}
export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}
export interface AvailabilityProfessional {
  id: string;
  periods: readonly WorkPeriod[];
  exceptions: readonly BusyInterval[];
  appointments: readonly BusyInterval[];
}
export interface AvailableSlot {
  startsAt: Date;
  endsAt: Date;
  professionalId: string;
}
function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function localTimeParts(value: string): { hours: number; minutes: number; seconds: number } {
  const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number);
  return { hours, minutes, seconds };
}
function isoDateOf(instant: Date, converter: TimeZoneConverter, timeZone: string): string {
  return converter.instantToLocalDateTime(instant, timeZone).slice(0, 10);
}
function overlaps(a: BusyInterval, startsAt: Date, endsAt: Date): boolean {
  return a.startsAt.getTime() < endsAt.getTime() && startsAt.getTime() < a.endsAt.getTime();
}

export function availableSlots(input: {
  date: string;
  now: Date;
  timeZone: string;
  slotIntervalMinutes: number;
  minimumAdvanceMinutes: number;
  durationMinutes: number;
  professionals: readonly AvailabilityProfessional[];
  converter: TimeZoneConverter;
  selectedProfessionalId?: string;
}): AvailableSlot[] {
  const {
    date,
    now,
    timeZone,
    slotIntervalMinutes,
    minimumAdvanceMinutes,
    durationMinutes,
    converter,
  } = input;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !converter.isValidTimeZone(timeZone) ||
    !Number.isInteger(slotIntervalMinutes) ||
    slotIntervalMinutes < 1 ||
    !Number.isInteger(minimumAdvanceMinutes) ||
    minimumAdvanceMinutes < 0 ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1
  )
    return [];
  const localToday = isoDateOf(now, converter, timeZone);
  if (date < localToday || date > addDays(localToday, 30)) return [];
  const minStart =
    minimumAdvanceMinutes === 0
      ? now.getTime() + 1
      : now.getTime() + minimumAdvanceMinutes * 60_000;
  const eligible = input.professionals.filter(
    (professional) =>
      !input.selectedProfessionalId || professional.id === input.selectedProfessionalId,
  );
  const byStart = new Map<
    number,
    { startsAt: Date; endsAt: Date; professionalId: string; load: number }
  >();
  for (const professional of eligible) {
    const load = professional.appointments
      .filter((appointment) => isoDateOf(appointment.startsAt, converter, timeZone) === date)
      .reduce(
        (total, appointment) =>
          total +
          Math.max(0, (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000),
        0,
      );
    for (const period of professional.periods) {
      const start = localTimeParts(period.startsAt);
      const finish = localTimeParts(period.endsAt);
      const first = start.hours * 60 + start.minutes;
      const last = finish.hours * 60 + finish.minutes;
      if (last <= first) continue;
      const periodEndCandidates = converter.localDateTimeToInstants(
        `${date}T${period.endsAt}`,
        timeZone,
      );
      const periodEnd = periodEndCandidates.at(-1);
      const closingLocal = `${date}T${period.endsAt}`;
      for (let minute = first; minute < last; minute += slotIntervalMinutes) {
        const local = `${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:${String(start.seconds).padStart(2, '0')}`;
        for (const startsAt of converter.localDateTimeToInstants(local, timeZone)) {
          const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
          if (startsAt.getTime() < minStart || (periodEnd && endsAt > periodEnd)) continue;
          // Um fechamento na lacuna civil não elimina a parte válida da jornada.
          // O fim real não pode reaparecer depois do fechamento após o salto do relógio.
          if (converter.instantToLocalDateTime(endsAt, timeZone) > closingLocal) continue;
          if (
            professional.exceptions.some((busy) => overlaps(busy, startsAt, endsAt)) ||
            professional.appointments.some((busy) => overlaps(busy, startsAt, endsAt))
          )
            continue;
          const current = byStart.get(startsAt.getTime());
          if (
            !current ||
            load < current.load ||
            (load === current.load && professional.id.localeCompare(current.professionalId) < 0)
          )
            byStart.set(startsAt.getTime(), {
              startsAt,
              endsAt,
              professionalId: professional.id,
              load,
            });
        }
      }
    }
  }
  return [...byStart.values()]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map(({ startsAt, endsAt, professionalId }) => ({ startsAt, endsAt, professionalId }));
}
