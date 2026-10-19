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

let startupStage = 'configuration';
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
  startupStage = 'initialization';
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
    abortOnError: false,
  });
  startupStage = 'http_setup';
  configureCorrelation(app, app.get(Telemetry));
  await app.register(helmet);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  startupStage = 'listening';
  await app.listen(env.PORT, '0.0.0.0');
}
void bootstrap().catch((error: unknown) => {
  new JsonLogger().logError('application_start_failed', error, {
    stage: startupStage,
    component: 'api',
  });
  process.exitCode = 1;
});
