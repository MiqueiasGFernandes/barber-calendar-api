import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JsonLogger } from '../../../../src/shared/observability/logger.js';
import { HealthController } from '../../../../src/shared/http/health.controller.js';
import { ProblemDetailsFilter } from '../../../../src/shared/http/problem-details.filter.js';
import {
  configureCorrelation,
  correlationRequestId,
} from '../../../../src/shared/http/correlation.js';
import { DATABASE } from '../../../../src/modules/authentication/authentication.module.js';
import { ApplicationError } from '../../../../src/shared/application/application-error.js';

@Controller('diagnostics-test')
class FailingController {
  @Get('failure') failure() {
    throw new Error('private@example.test', {
      cause: Object.assign(new Error('secret SQL details'), { code: 'ECONNREFUSED' }),
    });
  }
  @Get('rejected') rejected() {
    throw new ApplicationError(409, 'conflict', 'Conflict');
  }
}

describe('HTTP error diagnostics', () => {
  let app: NestFastifyApplication;
  const lines: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FailingController, HealthController],
      providers: [
        {
          provide: DATABASE,
          useValue: {
            query: async () => ({ rows: [{ revision: '001-tenant-authentication-v3' }] }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ requestIdHeader: false, genReqId: correlationRequestId }),
      { logger: false },
    );
    configureCorrelation(app);
    app.useGlobalFilters(new ProblemDetailsFilter(new JsonLogger((line) => lines.push(line))));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('logs correlated root causes and keeps the public 500 response generic', async () => {
    const id = randomUUID();
    const result = await app.inject({
      method: 'GET',
      url: '/diagnostics-test/failure?email=private@example.test',
      headers: { 'x-correlation-id': id, authorization: 'Bearer private-token' },
    });
    expect(result.statusCode).toBe(500);
    expect(result.json()).toMatchObject({ code: 'internal_error', correlation_id: id });
    expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({
      message: 'http_request_failed',
      correlation_id: id,
      stage: 'request',
      error: { cause: { code: 'ECONNREFUSED', message: 'Connection refused' } },
    });
    expect(lines.join('') + result.body).not.toMatch(/private@example|private-token|secret SQL/);
  });
  it('explains the expected and actual schema in logs only', async () => {
    const result = await app.inject({ method: 'GET', url: '/ready' });
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(lines.at(-1) ?? '{}').error).toMatchObject({
      code: 'UNSUPPORTED_SCHEMA',
      expected_revision: '002-appointment-scheduling-v2',
      actual_revision: '001-tenant-authentication-v3',
    });
    expect(result.body).not.toContain('001-tenant');
  });
  it('does not emit error stacks for expected business rejections', async () => {
    const before = lines.length;
    expect(
      (await app.inject({ method: 'GET', url: '/diagnostics-test/rejected' })).statusCode,
    ).toBe(409);
    expect(lines).toHaveLength(before);
  });
});
