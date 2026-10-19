import type { TransactionContext, TransactionManager } from '../../../../shared/application/ports/transaction.js';

export interface SchedulingTransaction extends TransactionManager {
  runForTenant<T>(tenantId: string, operation: (transaction: TransactionContext) => Promise<T>): Promise<T>;
}
