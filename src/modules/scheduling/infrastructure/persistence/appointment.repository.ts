import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { Appointment } from '../../domain/appointment.js';
import type { AppointmentWriter } from '../../application/ports/appointment-writer.js';

export class AppointmentRepository implements AppointmentWriter {
  async create(context: TransactionContext, appointment: Appointment, now: Date): Promise<void> {
    const input = appointment.input;
    await context.query(
      `INSERT INTO scheduling.appointments(
        id,public_id,tenant_id,professional_id,service_id,starts_at,ends_at,status,
        customer_name,customer_phone,customer_email,service_name_snapshot,duration_minutes_snapshot,
        price_minor_snapshot,currency_snapshot,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [input.id,input.publicId,input.tenantId,input.professionalId,input.serviceId,input.startsAt,input.endsAt,
        appointment.customerName,appointment.customerPhone,appointment.customerEmail,input.serviceName,
        input.durationMinutes,input.priceMinor,input.currency,now],
    );
  }
}
