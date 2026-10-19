import { Controller, Get, Inject } from '@nestjs/common';
import type { PostgresPool } from '../database/postgres-pool.js';
import { DATABASE } from '../../modules/authentication/authentication.module.js';
import {
  expectedSchemaRevision,
  SchemaCompatibilityError,
} from '../database/schema-compatibility.error.js';
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
    if (result.rows[0]?.revision !== expectedSchemaRevision)
      throw new SchemaCompatibilityError(result.rows[0]?.revision);
    return { status: 'ready', schema_revision: result.rows[0].revision };
  }
}
