import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { OUTBOX_DISPATCHER } from './modules/authentication/authentication.module.js';
import type { OutboxDispatcher } from './modules/outbox/infrastructure/outbox-dispatcher.js';

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dispatcher = context.get<OutboxDispatcher>(OUTBOX_DISPATCHER);
  let stopping = false;
  process.once('SIGTERM', () => {
    stopping = true;
    void context.close();
  });
  while (!stopping) {
    try {
      const processed = await dispatcher.dispatch();
      await new Promise((resolve) => setTimeout(resolve, processed === 0 ? 1000 : 25));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
void bootstrap();
