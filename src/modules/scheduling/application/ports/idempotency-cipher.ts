export interface IdempotencyCipher {
  encrypt(plaintext: Uint8Array, associatedData: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array, associatedData: Uint8Array): Uint8Array;
}

import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
export interface IdempotencyScope {
  tenantId: string;
  actorScope: string;
  operation: string;
  resourceScope: string;
  key: string;
  correlationId?: string;
}
export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}
export interface IdempotencyRecordRepository {
  find(
    context: TransactionContext,
    scope: IdempotencyScope,
    request: unknown,
  ): Promise<StoredResponse | null>;
  save(
    context: TransactionContext,
    scope: IdempotencyScope,
    request: unknown,
    response: StoredResponse,
    now: Date,
    appointmentId?: string,
  ): Promise<void>;
  deleteExpired(context: TransactionContext, tenantId: string, now: Date): Promise<void>;
}
