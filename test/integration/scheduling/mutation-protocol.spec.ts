import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresPool } from '../../../src/shared/database/postgres-pool.js';
import { SystemClock } from '../../../src/shared/application/ports/clock.js';
import { ApplicationError } from '../../../src/shared/application/application-error.js';
import { AesGcmIdempotencyCipher } from '../../../src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.js';
import { AppointmentIdempotencyRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.js';
import { SchedulingTransactionAdapter } from '../../../src/modules/scheduling/infrastructure/persistence/scheduling-transaction.adapter.js';
import { IdempotentMutationService } from '../../../src/modules/scheduling/application/services/idempotent-mutation.service.js';
import { AppointmentEventRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-event.repository.js';
import { AdministratorGuard } from '../../../src/modules/scheduling/infrastructure/http/administrator.guard.js';
import type { ExecutionContext } from '@nestjs/common';
import { adminPool } from '../../e2e/support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('scheduling mutation protocol', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const database = new PostgresPool({ connectionString: process.env.DATABASE_URL });
  const transactions = new SchedulingTransactionAdapter(database);
  const records = new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32, 6)));
  const service = new IdempotentMutationService(transactions, records, new SystemClock());
  const events = new AppointmentEventRepository();
  const tenants: string[] = [];
  async function tenant(): Promise<string> {
    const id = randomUUID(); tenants.push(id);
    await pool.query(`INSERT INTO tenancy.tenants(id,name,slug,created_at,updated_at) VALUES($1,'Protocol',$2,now(),now())`, [id, `protocol-${id}`]);
    await pool.query('INSERT INTO scheduling.tenant_settings(tenant_id) VALUES($1)', [id]);
    return id;
  }
  it('serializes mutations by tenant, allows other tenants through, and rolls back failures', async () => {
    const first = await tenant(); const second = await tenant();
    let release!: () => void; let entered!: () => void;
    const enteredLock = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const firstMutation = transactions.runForTenant(first, async () => { entered(); await hold; });
    await enteredLock;
    let sameTenantAcquired = false;
    const secondSame = transactions.runForTenant(first, async () => { sameTenantAcquired = true; });
    let otherTenantAcquired = false;
    await transactions.runForTenant(second, async () => { otherTenantAcquired = true; });
    expect(otherTenantAcquired).toBe(true);
    expect(sameTenantAcquired).toBe(false);
    release(); await Promise.all([firstMutation, secondSame]);
    await expect(transactions.runForTenant(first, async (tx) => {
      await tx.query('UPDATE scheduling.tenant_settings SET slot_interval_minutes=20 WHERE tenant_id=$1', [first]);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const saved = await pool.query('SELECT slot_interval_minutes FROM scheduling.tenant_settings WHERE tenant_id=$1', [first]);
    expect(saved.rows[0]?.slot_interval_minutes).toBe(15);
  });
  it('replays a concurrent request once, encrypts its response, and rejects a different body', async () => {
    const id = await tenant(); const scope = { tenantId: id, actorScope: 'public', operation: 'create', resourceScope: 'tenant', key: 'key-1234567890123456' };
    const serviceId=randomUUID();const professionalId=randomUUID();
    await pool.query(`INSERT INTO scheduling.services(id,tenant_id,name,duration_minutes,price_minor,created_at,updated_at) VALUES($1,$2,'Corte',30,5000,now(),now())`,[serviceId,id]);
    await pool.query(`INSERT INTO scheduling.professionals(id,tenant_id,name,created_at,updated_at) VALUES($1,$2,'Barber',now(),now())`,[professionalId,id]);
    await pool.query('INSERT INTO scheduling.professional_services(tenant_id,professional_id,service_id,created_at) VALUES($1,$2,$3,now())',[id,professionalId,serviceId]);
    let mutations = 0;
    const appointmentId=randomUUID();const publicId=randomUUID();
    const execute = (request: unknown) => service.execute(id, scope, request, async (tx, now) => {
      mutations++;
      await tx.query(`INSERT INTO scheduling.appointments(id,public_id,tenant_id,professional_id,service_id,starts_at,ends_at,customer_name,customer_phone,customer_email,service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot,currency_snapshot,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'2030-01-01T10:00:00Z','2030-01-01T10:30:00Z','Cliente','+5511999999999','client@example.test','Corte',30,5000,'BRL',$6,$6)`,[appointmentId,publicId,id,professionalId,serviceId,now]);
      await events.append(tx,{id:randomUUID(),tenantId:id,appointmentId,eventType:'created',actorMembershipId:null,occurredAt:now,correlationId:randomUUID(),previousStatus:null,newStatus:'confirmed',previousStartsAt:null,previousEndsAt:null,startsAt:new Date('2030-01-01T10:00:00Z'),endsAt:new Date('2030-01-01T10:30:00Z')});
      const body = { confirmation: 'reservation-token', contact: 'private@example.test' };
      return { result: body, appointmentId, response: { status: 201, headers: { location: '/appointments/x' }, body } };
    });
    const outcomes = await Promise.all([execute({ startsAt: '2030-01-01T10:00:00Z' }), execute({ startsAt: '2030-01-01T10:00:00Z' })]);
    expect(mutations).toBe(1);
    expect(outcomes.map(({ value, response }) => ({ value, response }))).toEqual([
      { value: outcomes[0]?.value, response: outcomes[0]?.response },
      { value: outcomes[0]?.value, response: outcomes[0]?.response },
    ]);
    expect(outcomes.filter(({ replayed }) => replayed)).toHaveLength(1);
    const eventCount=await pool.query('SELECT count(*)::int count FROM scheduling.appointment_events WHERE tenant_id=$1',[id]);
    expect(eventCount.rows[0]?.count).toBe(1);
    const stored = await pool.query<{ response_ciphertext: Buffer }>('SELECT response_ciphertext FROM scheduling.idempotency_records WHERE tenant_id=$1', [id]);
    expect(Buffer.from(stored.rows[0]?.response_ciphertext ?? []).includes(Buffer.from('private@example.test'))).toBe(false);
    await expect(execute({ startsAt: '2030-01-01T11:00:00Z' })).rejects.toBeInstanceOf(ApplicationError);
  });
  it('checks administrator authorization before returning an idempotent replay', async () => {
    const id=await tenant();const scope={tenantId:id,actorScope:randomUUID(),operation:'update',resourceScope:'service:one',key:'auth-12345678901234'};
    await service.execute(id,scope,{name:'service'},async()=>({result:{secret:'original'},response:{status:200,headers:{},body:{secret:'original'}}}));
    const guard=new AdministratorGuard();
    const context={switchToHttp:()=>({getRequest:()=>({auth:{tenantId:id,membershipId:scope.actorScope,userId:randomUUID(),role:'member',expiresAt:new Date(Date.now()+60_000)}})})} as unknown as ExecutionContext;
    await expect(Promise.resolve().then(()=>guard.canActivate(context)).then(()=>service.execute(id,scope,{name:'service'},async()=>({result:{secret:'wrong'},response:{status:200,headers:{},body:{secret:'wrong'}}})))).rejects.toMatchObject({status:403});
    const replay=await service.execute(id,scope,{name:'service'},async()=>({result:{secret:'wrong'},response:{status:200,headers:{},body:{secret:'wrong'}}}));
    expect(replay.value).toEqual({secret:'original'});expect(replay.response.status).toBe(200);expect(replay.replayed).toBe(true);
  });
  it('cleans expired responses under the tenant lock before processing a new command', async () => {
    const id = await tenant(); const scope = { tenantId: id, actorScope: 'public', operation: 'create', resourceScope: 'tenant', key: 'expire-123456789012' };
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await transactions.runForTenant(id, (tx) => records.save(tx, scope, {}, { status: 201, headers: {}, body: { old: true } }, old));
    const result = await service.execute(id, scope, {}, async () => ({ result: 'new', response: { status: 201, headers: {}, body: 'new' } }));
    expect(result.value).toBe('new');
    const count = await pool.query('SELECT count(*)::int count FROM scheduling.idempotency_records WHERE tenant_id=$1', [id]);
    expect(count.rows[0]?.count).toBe(1);
  });
  afterAll(async () => {
    await adminPool.query('ALTER TABLE scheduling.appointment_events DISABLE TRIGGER USER');
    for (const id of tenants) {
      await adminPool.query('DELETE FROM scheduling.appointment_events WHERE tenant_id=$1', [id]);
      await adminPool.query('DELETE FROM scheduling.idempotency_records WHERE tenant_id=$1', [id]);
      await adminPool.query('DELETE FROM scheduling.appointments WHERE tenant_id=$1', [id]);
      await adminPool.query('DELETE FROM scheduling.professional_services WHERE tenant_id=$1', [id]);
      await adminPool.query('DELETE FROM scheduling.professionals WHERE tenant_id=$1', [id]);
      await adminPool.query('DELETE FROM scheduling.services WHERE tenant_id=$1', [id]);
      await adminPool.query('DELETE FROM scheduling.tenant_settings WHERE tenant_id=$1', [id]);
      await adminPool.query('DELETE FROM tenancy.tenants WHERE id=$1', [id]);
    }
    await adminPool.query('ALTER TABLE scheduling.appointment_events ENABLE TRIGGER USER');
    await Promise.all([pool.end(), adminPool.end(), database.close()]);
  });
});
