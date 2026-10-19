import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { JsonLogger } from '../../../../src/shared/observability/logger.js';
import { parseEnvironment } from '../../../../src/shared/config/environment.schema.js';
import { SchemaCompatibilityError } from '../../../../src/shared/database/schema-compatibility.error.js';

describe('error diagnostics', () => {
  it('identifies invalid environment fields without logging values or validation messages', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((line) => lines.push(line));
    try {
      parseEnvironment({ DATABASE_URL: 'private-contact@example.test', PORT: 'private-port' });
    } catch (error) {
      logger.logError('application_start_failed', error, {
        stage: 'configuration',
        component: 'api',
      });
    }
    const record = JSON.parse(lines[0] ?? '{}');
    expect(record).toMatchObject({
      level: 'error',
      message: 'application_start_failed',
      stage: 'configuration',
      component: 'api',
      error: {
        type: 'ZodError',
        code: 'INVALID_CONFIGURATION',
        message: 'Environment configuration is invalid',
      },
    });
    expect(record.error.validation_issues).toEqual(
      expect.arrayContaining([
        {
          field: 'IDEMPOTENCY_ENCRYPTION_KEY',
          code: 'invalid_type',
          requirement: 'Base64 encoding of exactly 32 bytes',
        },
        {
          field: 'DATABASE_URL',
          code: 'invalid_format',
          requirement: 'Valid absolute database connection URL',
        },
      ]),
    );
    expect(record.error.stack.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain('private-contact');
    expect(lines.join('')).not.toContain('private-port');
  });

  it('preserves stack locations and database root cause without copying messages or SQL details', () => {
    const lines: string[] = [];
    const secret = 'private@example.test postgres://user:password@db/private ghp_opaque-secret';
    const cause = Object.assign(new Error(secret), {
      code: '42P01',
      detail: secret,
      query: secret,
    });
    const error = new Error(secret, { cause });
    const id = randomUUID();
    new JsonLogger((line) => lines.push(line)).logError('http_request_failed', error, {
      correlation_id: id,
      status_code: 500,
    });
    const record = JSON.parse(lines[0] ?? '{}');
    expect(record.correlation_id).toBe(id);
    expect((record.error.stack as string[]).join('\n')).toContain('error-diagnostics.spec.ts:');
    expect(record.error.cause).toMatchObject({
      type: 'Error',
      code: '42P01',
      message: 'Database relation does not exist',
    });
    expect(record.error.message).toBe('Unexpected error; inspect stack and cause');
    expect(lines.join('')).not.toContain(secret);
    expect(lines.join('')).not.toContain('password');
  });

  it('bounds cyclic causes and aggregate failures and tolerates non-Error throws', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((line) => lines.push(line));
    const cyclic = new Error('private-value');
    cyclic.cause = cyclic;
    logger.logError(
      'worker_iteration_failed',
      new AggregateError([cyclic, 'private-value'], 'private-value'),
    );
    logger.logError('application_start_failed', {
      message: 'private-value',
      password: 'private-value',
    });
    const record = JSON.parse(lines[0] ?? '{}');
    expect(record.error.errors[0].cause.truncated).toBe(true);
    expect(record.error.errors[1].type).toBe('NonError');
    expect(lines.join('')).not.toContain('private-value');
    expect(lines.join('').length).toBeLessThan(20_000);
  });

  it('never treats multiline messages as stack frames or serializes arbitrary metadata', () => {
    const lines: string[] = [];
    const error = Object.assign(new Error('private@example.test\nAuthorization: Bearer secret'), {
      code: 'private-code',
      headers: { authorization: 'private-token' },
    });
    new JsonLogger((line) => lines.push(line)).logError('http_request_failed', error);
    expect(JSON.parse(lines[0] ?? '{}').error.stack.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toMatch(/private@example|private-token|private-code|Bearer secret/);
  });

  it('does not log arbitrary schema revisions and survives exceptions with throwing accessors', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((line) => lines.push(line));
    logger.logError('http_request_failed', new SchemaCompatibilityError('private-schema-value'));
    const error = new Error('private-message');
    Object.defineProperty(error, 'cause', {
      get() {
        throw new Error('private-accessor');
      },
    });
    expect(() => logger.logError('http_request_failed', error)).not.toThrow();
    expect(JSON.parse(lines[0] ?? '{}').error.actual_revision).toBe('unknown');
    expect(lines.join('')).not.toMatch(/private-schema-value|private-message|private-accessor/);
  });

  it('removes the entire error message even when it contains forged V8 stack frames', () => {
    const lines: string[] = [];
    const error = new Error('private-message\n    at /app/src/private-credential.ts:42:1');
    new JsonLogger((line) => lines.push(line)).logError('http_request_failed', error);
    expect(lines.join('')).not.toMatch(/private-message|private-credential/);
    expect(JSON.parse(lines[0] ?? '{}').error.stack.length).toBeGreaterThan(0);
  });
});
