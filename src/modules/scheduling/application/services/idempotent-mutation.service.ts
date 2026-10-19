import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { SchedulingTransaction } from '../ports/scheduling-transaction.js';
import type { IdempotencyRecordRepository, IdempotencyScope, StoredResponse } from '../ports/idempotency-cipher.js';

export class IdempotentMutationService {
  constructor(private readonly transactions: SchedulingTransaction, private readonly records: IdempotencyRecordRepository, private readonly clock: Clock) {}
  execute<T>(tenantId: string, scope: IdempotencyScope, request: unknown, mutation: (context: TransactionContext, now: Date) => Promise<{ result: T; response: StoredResponse; appointmentId?: string }>): Promise<T> {
    return this.transactions.runForTenant(tenantId, async (context) => {
      const now = this.clock.now();
      await this.records.deleteExpired(context, tenantId, now);
      const existing = await this.records.find(context, scope, request);
      if (existing) return existing.body as T;
      const performed = await mutation(context, now);
      await this.records.save(context, scope, request, performed.response, now, performed.appointmentId);
      return performed.result;
    });
  }
}
