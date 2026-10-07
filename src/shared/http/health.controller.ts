import { Controller, Get, Inject } from '@nestjs/common';
import type { PostgresPool } from '../database/postgres-pool.js';
import { DATABASE } from '../../modules/authentication/authentication.module.js';
@Controller()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: PostgresPool) {}
  @Get('health') health() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    const result = await this.database.query<{ revision: string }>(
      `SELECT revision FROM app_meta.schema_build WHERE singleton`,
    );
    if (result.rows[0]?.revision !== '001-tenant-authentication-v3')
      throw new Error('unsupported schema');
    return { status: 'ready', schema_revision: result.rows[0].revision };
  }
}
