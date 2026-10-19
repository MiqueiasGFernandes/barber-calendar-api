import { createHash } from 'node:crypto';
import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { IdempotencyCipher, IdempotencyRecordRepository, IdempotencyScope, StoredResponse } from '../../application/ports/idempotency-cipher.js';
import { ApplicationError } from '../../../../shared/application/application-error.js';

export type { IdempotencyScope, StoredResponse } from '../../application/ports/idempotency-cipher.js';
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
function hashes(scope: IdempotencyScope, request: unknown) {
  const keyHash = createHash('sha256').update(scope.key).digest();
  const requestHash = createHash('sha256').update(canonical(request)).digest();
  const aad = Buffer.from([scope.tenantId, scope.actorScope, scope.operation, scope.resourceScope, keyHash.toString('hex')].join(':'));
  return { keyHash, requestHash, aad };
}

export class AppointmentIdempotencyRepository implements IdempotencyRecordRepository {
  constructor(private readonly cipher: IdempotencyCipher) {}
  async find(context: TransactionContext, scope: IdempotencyScope, request: unknown): Promise<StoredResponse | null> {
    const { keyHash, requestHash, aad } = hashes(scope, request);
    const result = await context.query<{ request_hash: Buffer; response_status: number; response_headers: Record<string, string>; response_ciphertext: Buffer }>(
      `SELECT request_hash,response_status,response_headers,response_ciphertext FROM scheduling.idempotency_records
       WHERE tenant_id=$1 AND actor_scope=$2 AND operation=$3 AND resource_scope=$4 AND key_hash=$5 AND expires_at>clock_timestamp() FOR UPDATE`,
      [scope.tenantId, scope.actorScope, scope.operation, scope.resourceScope, keyHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!row.request_hash.equals(requestHash)) throw new ApplicationError(409, 'idempotency_conflict', 'Idempotency key was used with a different request');
    const bytes = this.cipher.decrypt(row.response_ciphertext, aad);
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as StoredResponse;
  }
  async save(context: TransactionContext, scope: IdempotencyScope, request: unknown, response: StoredResponse, now: Date, appointmentId?: string): Promise<void> {
    const { keyHash, requestHash, aad } = hashes(scope, request);
    const ciphertext = this.cipher.encrypt(Buffer.from(JSON.stringify(response)), aad);
    await context.query(
      `INSERT INTO scheduling.idempotency_records(id,tenant_id,actor_scope,operation,resource_scope,key_hash,request_hash,appointment_id,response_status,response_headers,response_ciphertext,created_at,expires_at)
       VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::timestamptz,$11::timestamptz+interval '24 hours')`,
      [scope.tenantId, scope.actorScope, scope.operation, scope.resourceScope, keyHash, requestHash, appointmentId ?? null, response.status, JSON.stringify(response.headers), ciphertext, now],
    );
  }
  async deleteExpired(context: TransactionContext, tenantId: string, now: Date): Promise<void> {
    await context.query('DELETE FROM scheduling.idempotency_records WHERE tenant_id=$1 AND expires_at<=$2', [tenantId, now]);
  }
}
