import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './shared/http/problem-details.filter.js';
import { parseEnvironment } from './shared/config/environment.schema.js';

async function bootstrap(): Promise<void> {
  const env = parseEnvironment(process.env),
    adapter = new FastifyAdapter({
      trustProxy: true,
      logger: {
        level: 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.code',
            'req.body.email',
            'req.body.administrator_email',
          ],
          censor: '[REDACTED]',
        },
      },
    });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  await app.register(helmet);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}
void bootstrap();
