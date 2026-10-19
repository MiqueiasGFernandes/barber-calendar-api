import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { SchedulingTransaction } from '../ports/scheduling-transaction.js';
import type {
  IdempotencyRecordRepository,
  IdempotencyScope,
  StoredResponse,
} from '../ports/idempotency-cipher.js';
import type { SchedulingObservabilityService } from './scheduling-observability.service.js';

export class IdempotentMutationService {
  constructor(
    private readonly transactions: SchedulingTransaction,
    private readonly records: IdempotencyRecordRepository,
    private readonly clock: Clock,
    private readonly observability?: SchedulingObservabilityService,
  ) {}
  async execute<T>(
    tenantId: string,
    scope: IdempotencyScope,
    request: unknown,
    mutation: (
      context: TransactionContext,
      now: Date,
    ) => Promise<{ result: T; response: StoredResponse; appointmentId?: string }>,
  ): Promise<{ value: T; response: StoredResponse; replayed: boolean }> {
    const result = await this.transactions.runForTenant(tenantId, async (context) => {
      const now = this.clock.now();
      await this.records.deleteExpired(context, tenantId, now);
      const existing = await this.records.find(context, scope, request);
      if (existing) return { value: existing.body as T, response: existing, replayed: true };
      const performed = await mutation(context, now);
      await this.records.save(
        context,
        scope,
        request,
        performed.response,
        now,
        performed.appointmentId,
      );
      return { value: performed.result, response: performed.response, replayed: false };
    });
    const body = result.response.body;
    const status = body && typeof body === 'object' && 'status' in body ? body.status : undefined;
    this.observability?.committed(scope, result.replayed, status);
    return result;
  }
}
