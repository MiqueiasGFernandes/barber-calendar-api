import { Module } from '@nestjs/common';
import { ConfigModule } from './shared/config/config.module.js';
import { AuthenticationModule } from './modules/authentication/authentication.module.js';
import { HealthController } from './shared/http/health.controller.js';
@Module({ imports: [ConfigModule, AuthenticationModule], controllers: [HealthController] })
export class AppModule {}
