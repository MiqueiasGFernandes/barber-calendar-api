import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  OUTBOX_DISPATCHER,
  THROTTLE_RETENTION_JOB,
} from './modules/authentication/authentication.module.js';
import type { OutboxDispatcher } from './modules/outbox/infrastructure/outbox-dispatcher.js';
import type { ThrottleRetentionJob } from './modules/authentication/infrastructure/persistence/throttle-retention.job.js';
import { Telemetry } from './shared/observability/telemetry.js';
import { JsonLogger } from './shared/observability/logger.js';

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const telemetry = context.get(Telemetry);
  const dispatcher = context.get<OutboxDispatcher>(OUTBOX_DISPATCHER);
  const retention = context.get<ThrottleRetentionJob>(THROTTLE_RETENTION_JOB);
  let stopping = false;
  let lastRetention = 0;
  process.once('SIGTERM', () => {
    stopping = true;
    void context.close();
  });
  while (!stopping) {
    const correlationId = randomUUID();
    try {
      const dispatchOperation = telemetry.start('outbox_poll', { correlationId });
      let processed: number;
      try {
        processed = await dispatcher.dispatch();
        dispatchOperation.finish('succeeded');
      } catch {
        dispatchOperation.finish('failed');
        throw new Error('outbox dispatch failed');
      }
      if (Date.now() - lastRetention >= 60 * 60 * 1000) {
        const operation = telemetry.start('throttle_retention', { correlationId: randomUUID() });
        try {
          await retention.purge();
          operation.finish('succeeded');
        } catch {
          operation.finish('failed');
          throw new Error('throttle retention failed');
        }
        lastRetention = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, processed === 0 ? 1000 : 25));
    } catch {
      // Raw provider/SQL errors can contain email addresses, IPs, tokens or payload fragments.
      telemetry.log('error', 'worker_iteration_failed', {
        correlation_id: correlationId,
        operation: 'outbox_poll',
        outcome: 'failed',
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
void bootstrap().catch(() => {
  new JsonLogger().log('error', 'application_start_failed');
  process.exitCode = 1;
});
