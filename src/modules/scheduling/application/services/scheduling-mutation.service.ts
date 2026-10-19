import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { SchedulingTransaction } from '../ports/scheduling-transaction.js';

export class SchedulingMutationService {
  constructor(private readonly transactions: SchedulingTransaction, private readonly clock: Clock) {}
  execute<T>(tenantId: string, mutation: (context: TransactionContext, now: Date) => Promise<T>): Promise<T> {
    return this.transactions.runForTenant(tenantId, async (context) => mutation(context, this.clock.now()));
  }
  async lockAppointments(context: TransactionContext, appointmentIds: readonly string[]): Promise<void> {
    for (const id of [...new Set(appointmentIds)].sort()) {
      await context.query('SELECT id FROM scheduling.appointments WHERE id=$1 FOR UPDATE', [id]);
    }
  }
}
