export class ApplicationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly conflictingAppointmentIds?: readonly string[],
  ) {
    super(message);
  }
}
