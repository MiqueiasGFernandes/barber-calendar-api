import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  configurationOperations,
  configurationResourceTypes,
} from '../../src/modules/scheduling/application/ports/configuration-audit-writer.js';
import { configurationDiff } from '../../src/modules/scheduling/application/services/configuration-audit.service.js';
describe('contrato interno de auditoria', () => {
  it('mapeia nove operações existentes sem acrescentar rota HTTP', () => {
    const contract = parse(
      readFileSync('specs/002-appointment-scheduling/contracts/openapi.yaml', 'utf8'),
    );
    const ops = Object.values(contract.paths).flatMap((path: any) =>
      Object.values(path)
        .filter((x: any) => x.operationId)
        .map((x: any) => x.operationId),
    );
    expect(ops).toHaveLength(22);
    for (const op of configurationOperations) expect(ops).toContain(op);
    expect(configurationOperations).toHaveLength(9);
    expect(configurationResourceTypes).toHaveLength(6);
    expect(Object.keys(contract.paths).some((p) => p.includes('audit'))).toBe(false);
  });
  it('produz before/after tipados somente para campos do recurso', () => {
    expect(
      configurationDiff(
        'tenant_settings',
        { slot_interval_minutes: 15 },
        { slot_interval_minutes: 20, tenant_id: 'injected' },
      ),
    ).toEqual({ slot_interval_minutes: { before: 15, after: 20 } });
  });
});
