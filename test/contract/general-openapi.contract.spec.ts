import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { Ajv } from 'ajv';
import { buildOpenApi } from '../../scripts/build-openapi.js';
import { expectedSchemaRevision } from '../../src/shared/database/schema-compatibility.error.js';

const api = buildOpenApi();
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (object(value)) {
    visit(value);
    for (const item of Object.values(value)) walk(item, visit);
  }
}
function pointer(reference: string): unknown {
  return reference
    .slice(2)
    .split('/')
    .reduce<unknown>(
      (node, part) =>
        object(node) ? node[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined,
      api,
    );
}

describe('documentação OpenAPI geral', () => {
  it('covers every implemented controller route and preserves versioned and root addresses', () => {
    const documented = new Set<string>();
    for (const [path, item] of Object.entries(api.paths))
      for (const [method, operation] of Object.entries(item)) {
        if (methods.has(method) && object(operation))
          documented.add(
            `${method.toUpperCase()}${path === '/ready' || path === '/health' ? '' : '/v1'}${path}`,
          );
      }
    const controllers = readdirSync('src/modules', { recursive: true, encoding: 'utf8' })
      .filter((path): path is string => typeof path === 'string')
      .filter((path) => path.endsWith('.controller.ts'))
      .map((path) => resolve('src/modules', path));
    controllers.push('src/shared/http/health.controller.ts');
    const implemented = new Set<string>();
    for (const file of controllers) {
      const source = readFileSync(file, 'utf8');
      const base = /@Controller\('([^']+)'\)/.exec(source)?.[1] ?? '';
      for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g)) {
        const path = `/${[base, match[2]].filter(Boolean).join('/')}`.replace(/:([\w]+)/g, '{$1}');
        implemented.add(`${match[1]?.toUpperCase()}${path}`);
      }
    }
    expect([...documented].sort()).toEqual([...implemented].sort());
    expect(documented.size).toBe(27);
    expect(api.paths['/ready']?.servers).toEqual([{ url: '/' }]);
    expect(api.servers).toMatchObject([{ url: '/v1' }]);
  });

  it('resolves all component references and keeps distinct error shapes and correct security', () => {
    walk(api, (node) => {
      if (typeof node.$ref === 'string') {
        expect(node.$ref).toMatch(/^#\//);
        expect(pointer(node.$ref), node.$ref).toBeDefined();
      }
    });
    expect(api.components.schemas?.AuthenticationProblem).not.toEqual(
      api.components.schemas?.SchedulingProblem,
    );
    for (const [path, item] of Object.entries(api.paths))
      for (const [method, operation] of Object.entries(item)) {
        if (!methods.has(method) || !object(operation)) continue;
        expect(operation.security).toEqual(
          path.startsWith('/management/') ? [{ bearerAuth: [] }] : [],
        );
        const parameters = Array.isArray(operation.parameters)
          ? operation.parameters.map((parameter: unknown) =>
              object(parameter) && typeof parameter.$ref === 'string'
                ? pointer(parameter.$ref)
                : parameter,
            )
          : [];
        for (const match of path.matchAll(/\{([^}]+)\}/g))
          expect(parameters).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ name: match[1], in: 'path', required: true }),
            ]),
          );
      }
    expect(api.components.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });
  });

  it('validates documented examples and operational readiness against the current application revision', () => {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    ajv.addSchema(api, 'https://barber-calendar.test/general-openapi');
    for (const [file, schema] of [
      ['registration', 'AuthenticationTenantRegistrationRequest'],
      ['login', 'AuthenticationOtpRequest'],
    ]) {
      const validate = ajv.compile({
        $ref: `https://barber-calendar.test/general-openapi#/components/schemas/${schema}`,
      });
      expect(
        validate(JSON.parse(readFileSync(`docs/openapi/examples/${file}.json`, 'utf8'))),
        JSON.stringify(validate.errors),
      ).toBe(true);
    }
    const ready = api.paths['/ready']?.get as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    };
    const validateReady = ajv.compile(
      ready.responses['200']?.content['application/json']?.schema as object,
    );
    expect(validateReady({ status: 'ready', schema_revision: expectedSchemaRevision })).toBe(true);
    expect(
      validateReady({ status: 'ready', schema_revision: '001-tenant-authentication-v3' }),
    ).toBe(false);
    expect(YAML.parse(readFileSync('docs/openapi/openapi.yaml', 'utf8'))).toEqual(api);
    expect(JSON.parse(readFileSync('docs/openapi/openapi.json', 'utf8'))).toEqual(api);
  });
});
