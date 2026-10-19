import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

describe('compiled startup diagnostics', () => {
  it.each(['main', 'worker'])(
    'reports missing configuration from the real %s entrypoint and exits unsuccessfully',
    (entrypoint) => {
      const result = spawnSync(
        process.execPath,
        ['--enable-source-maps', `dist/${entrypoint}.js`],
        {
          env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production' },
          encoding: 'utf8',
          timeout: 15_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      const logs = result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        message: 'application_start_failed',
        component: entrypoint === 'main' ? 'api' : 'worker',
        stage: 'configuration',
        error: {
          code: 'INVALID_CONFIGURATION',
          validation_issues: expect.arrayContaining([
            {
              field: 'IDEMPOTENCY_ENCRYPTION_KEY',
              code: 'invalid_type',
              requirement: 'Base64 encoding of exactly 32 bytes',
            },
          ]),
        },
      });
      expect((logs[0].error.stack as string[]).join('\n')).toContain(
        'src/shared/config/environment.schema.ts:',
      );
      expect(result.stderr).toBe('');
    },
  );

  it('captures listen failures after Nest initialization without aborting or exposing the database URL', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address');
      const result = spawnSync(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          PORT: String(address.port),
          DATABASE_URL: 'postgres://private-user:private-password@localhost/unused',
          OTP_HMAC_KEY: 'x'.repeat(32),
          THROTTLE_HMAC_KEY: 'y'.repeat(32),
          OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
          IDEMPOTENCY_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
          JWT_PRIVATE_KEY: 'unused-private-key',
          JWT_PUBLIC_KEY: 'unused-public-key',
          JWT_KEY_ID: 'test',
          JWT_ISSUER: 'test',
          JWT_AUDIENCE: 'test',
        },
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      const record = JSON.parse(result.stdout.trim());
      expect(record).toMatchObject({
        message: 'application_start_failed',
        stage: 'listening',
        error: { code: 'EADDRINUSE', message: 'Listen address is already in use' },
      });
      expect(record.error.stack.length).toBeGreaterThan(0);
      expect(result.stdout + result.stderr).not.toMatch(
        /private-user|private-password|unused-private-key/,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
