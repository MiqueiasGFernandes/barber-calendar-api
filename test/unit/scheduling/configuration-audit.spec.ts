import { describe, expect, it } from 'vitest';
import { configurationDiff } from '../../../src/modules/scheduling/application/services/configuration-audit.service.js';

describe('diff da auditoria administrativa', () => {
  it('registra criação/remoção, ignora campos externos e não cria mudanças fictícias', () => {
    expect(
      configurationDiff('professional', null, {
        display_name: 'Nome',
        status: 'active',
        password: 'secret',
      }),
    ).toEqual({
      display_name: { before: null, after: '[REDACTED]', redacted: true },
      status: { before: null, after: 'active' },
    });
    expect(
      configurationDiff('professional', { display_name: 'Nome', status: 'active' }, null),
    ).toEqual({
      display_name: { before: '[REDACTED]', after: null, redacted: true },
      status: { before: 'active', after: null },
    });
    expect(
      configurationDiff('professional', { display_name: 'Nome' }, { display_name: 'Nome' }),
    ).toEqual({});
  });
  it('normaliza conjuntos e jornadas sem considerar IDs físicos ou ordem', () => {
    expect(
      configurationDiff(
        'service',
        { professional_ids: ['b', 'a', 'a'] },
        { professional_ids: ['a', 'b'] },
      ),
    ).toEqual({});
    const first = { iso_weekday: 1, starts_local_time: '09:00:00', ends_local_time: '12:00:00' };
    const second = { iso_weekday: 2, starts_local_time: '09:00:00', ends_local_time: '12:00:00' };
    expect(
      configurationDiff(
        'weekly_periods',
        { periods: [{ ...first, id: 'old' }, second] },
        { periods: [second, { ...first, id: 'new' }] },
      ),
    ).toEqual({});
  });
  it('redige strings sensíveis antes de persistir sem perder a existência da mudança', () => {
    const diff = configurationDiff(
      'availability_exception',
      { reason: 'a@example.test' },
      { reason: 'b@example.test', guest_phone: '+5511999999999' },
    );
    expect(diff).toEqual({ reason: { before: '[REDACTED]', after: '[REDACTED]', redacted: true } });
    for (const value of ['+5511999999999', 'Bearer abc123', 'password=hunter2', 'secret-value']) {
      expect(configurationDiff('service', null, { description: value })).toEqual({
        description: { before: null, after: '[REDACTED]', redacted: true },
      });
    }
  });
  it('redige todo texto livre sem depender de formato ou palavra que identifique uma credencial', () => {
    const samples = [
      'ghp_' + 'X'.repeat(36),
      '-----BEGIN PRIVATE KEY-----\n' + 'Y'.repeat(32) + '\n-----END PRIVATE KEY-----',
      'valorOpacoSemRotulo',
    ];
    for (const [type, field] of [
      ['service', 'name'],
      ['service', 'description'],
      ['professional', 'display_name'],
      ['availability_exception', 'reason'],
    ] as const) {
      for (const value of samples) {
        const changes = configurationDiff(type, { [field]: value }, { [field]: 'Texto comum' });
        expect(changes[field]).toEqual({
          before: '[REDACTED]',
          after: '[REDACTED]',
          redacted: true,
        });
        expect(JSON.stringify(changes)).not.toContain(value);
      }
    }
    expect(
      configurationDiff(
        'service',
        { name: 'Original', price_minor: 100 },
        { name: 'Novo', price_minor: 200 },
      ),
    ).toEqual({
      name: { before: '[REDACTED]', after: '[REDACTED]', redacted: true },
      price_minor: { before: 100, after: 200 },
    });
  });
});
