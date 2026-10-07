import { Global, Module } from '@nestjs/common';
import { parseEnvironment, type Environment } from './environment.schema.js';

export const ENVIRONMENT = Symbol('ENVIRONMENT');
@Global()
@Module({
  providers: [
    { provide: ENVIRONMENT, useFactory: (): Environment => parseEnvironment(process.env) },
  ],
  exports: [ENVIRONMENT],
})
export class ConfigModule {}
