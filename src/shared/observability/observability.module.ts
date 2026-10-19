import { Global, Module } from '@nestjs/common';
import type { Environment } from '../config/environment.schema.js';
import { ENVIRONMENT } from '../config/config.module.js';
import { Telemetry } from './telemetry.js';

@Global()
@Module({
  providers: [
    {
      provide: Telemetry,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) =>
        new Telemetry({
          ...(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
            ? { tracesEndpoint: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT }
            : {}),
          ...(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
            ? { metricsEndpoint: env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT }
            : {}),
        }),
    },
  ],
  exports: [Telemetry],
})
export class ObservabilityModule {}
