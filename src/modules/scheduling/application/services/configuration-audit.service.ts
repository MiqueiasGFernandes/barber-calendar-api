import { randomUUID } from 'node:crypto';
import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type {
  AuditValue,
  ConfigurationAuditReader,
  ConfigurationAuditWriter,
  ConfigurationChanges,
  ConfigurationOperation,
  ConfigurationResourceType,
  ConfigurationSnapshot,
} from '../ports/configuration-audit-writer.js';

const fields: Record<ConfigurationResourceType, readonly string[]> = {
  service: [
    'name',
    'description',
    'duration_minutes',
    'price_minor',
    'currency_code',
    'status',
    'professional_ids',
  ],
  professional: ['display_name', 'status'],
  weekly_periods: ['periods'],
  availability_exception: ['professional_id', 'kind', 'starts_at', 'ends_at', 'reason'],
  time_zone: ['time_zone'],
  tenant_settings: ['slot_interval_minutes', 'minimum_advance_minutes'],
};
function canonical(value: AuditValue): AuditValue {
  if (Array.isArray(value))
    return [
      ...new Map(
        value.map((v) => {
          const normalized = canonical(v);
          return [JSON.stringify(normalized), normalized] as const;
        }),
      ).values(),
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => k !== 'id')
        .sort()
        .map((k) => [k, canonical(value[k] ?? null)]),
    );
  return value;
}
// Texto livre pode conter credenciais de qualquer formato. A trilha registra a mudança,
// mas nunca copia seu conteúdo; valores estruturados continuam disponíveis no diff.
function redactFreeText(value: AuditValue): { value: AuditValue; redacted: boolean } {
  return value === null
    ? { value: null, redacted: false }
    : { value: '[REDACTED]', redacted: true };
}
export function configurationDiff(
  type: ConfigurationResourceType,
  before: ConfigurationSnapshot,
  after: ConfigurationSnapshot,
): ConfigurationChanges {
  const changes: ConfigurationChanges = {};
  for (const field of fields[type]) {
    const a = canonical(before?.[field] ?? null),
      b = canonical(after?.[field] ?? null);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const freeText = ['name', 'display_name', 'description', 'reason'].includes(field);
    const old = freeText ? redactFreeText(a) : { value: a, redacted: false },
      next = freeText ? redactFreeText(b) : { value: b, redacted: false };
    changes[field] = {
      before: old.value,
      after: next.value,
      ...(old.redacted || next.redacted ? { redacted: true as const } : {}),
    };
  }
  return changes;
}
const resources: Record<ConfigurationOperation, ConfigurationResourceType> = {
  createService: 'service',
  updateService: 'service',
  createProfessional: 'professional',
  updateProfessional: 'professional',
  replaceWeeklyWorkPeriods: 'weekly_periods',
  createAvailabilityException: 'availability_exception',
  deleteAvailabilityException: 'availability_exception',
  updateTenantTimeZone: 'time_zone',
  updateSchedulingSettings: 'tenant_settings',
};
export class ConfigurationAuditService {
  constructor(
    private readonly reader: ConfigurationAuditReader,
    private readonly writer: ConfigurationAuditWriter,
  ) {}
  async run<T extends { body: unknown }>(
    context: TransactionContext,
    metadata: {
      tenantId: string;
      membershipId: string;
      correlationId?: string;
      operation: ConfigurationOperation;
      resource: string;
      now: Date;
    },
    mutation: () => Promise<T>,
  ): Promise<T> {
    const type = resources[metadata.operation];
    const creating = metadata.operation.startsWith('create');
    let id =
      type === 'tenant_settings' || type === 'time_zone'
        ? metadata.tenantId
        : metadata.operation === 'deleteAvailabilityException'
          ? (metadata.resource.split(':')[1] ?? '')
          : metadata.resource;
    const before = creating
      ? null
      : await this.reader.snapshot(context, metadata.tenantId, type, id);
    const response = await mutation();
    if (creating) {
      if (
        !response.body ||
        typeof response.body !== 'object' ||
        !('id' in response.body) ||
        typeof response.body.id !== 'string'
      )
        throw new Error('Missing configuration resource identity');
      id = response.body.id;
    }
    const after = await this.reader.snapshot(context, metadata.tenantId, type, id);
    const changes = configurationDiff(type, before, after);
    if (Object.keys(changes).length)
      await this.writer.append(context, {
        id: randomUUID(),
        tenantId: metadata.tenantId,
        actorMembershipId: metadata.membershipId,
        operationId: randomUUID(),
        operation: metadata.operation,
        resourceType: type,
        resourceId: id,
        occurredAt: metadata.now,
        correlationId: metadata.correlationId ?? randomUUID(),
        changes,
      });
    return response;
  }
}
