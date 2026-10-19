import { Module } from '@nestjs/common';
import { ObservabilityModule } from './shared/observability/observability.module.js';
import { ConfigModule } from './shared/config/config.module.js';
import { AuthenticationModule } from './modules/authentication/authentication.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { HealthController } from './shared/http/health.controller.js';
@Module({
  imports: [ConfigModule, ObservabilityModule, AuthenticationModule, SchedulingModule],
  controllers: [HealthController],
})
export class AppModule {}
