import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './shared/http/problem-details.filter.js';
import { parseEnvironment } from './shared/config/environment.schema.js';
import { configureCorrelation, correlationRequestId } from './shared/http/correlation.js';
import { Telemetry } from './shared/observability/telemetry.js';
import { JsonLogger } from './shared/observability/logger.js';

async function bootstrap(): Promise<void> {
  const env = parseEnvironment(process.env),
    adapter = new FastifyAdapter({
      trustProxy:
        env.TRUSTED_PROXY_CIDRS?.split(',')
          .map((cidr) => cidr.trim())
          .filter(Boolean) ?? false,
      requestIdHeader: false,
      genReqId: correlationRequestId,
    });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });
  configureCorrelation(app, app.get(Telemetry));
  await app.register(helmet);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}
void bootstrap().catch(() => {
  new JsonLogger().log('error', 'application_start_failed');
  process.exitCode = 1;
});
