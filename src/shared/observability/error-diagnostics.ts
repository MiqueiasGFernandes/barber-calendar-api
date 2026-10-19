import { ZodError } from 'zod';
import { environmentSchema } from '../config/environment.schema.js';
import {
  expectedSchemaRevision,
  SchemaCompatibilityError,
} from '../database/schema-compatibility.error.js';

const technicalMessages = {
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection reset',
  ETIMEDOUT: 'Connection timed out',
  ENOTFOUND: 'Host name could not be resolved',
  EAI_AGAIN: 'Temporary DNS resolution failure',
  EADDRINUSE: 'Listen address is already in use',
  EACCES: 'Permission denied',
  ERR_MODULE_NOT_FOUND: 'Required module was not found',
  ERR_OSSL_UNSUPPORTED: 'Cryptographic key or operation is unsupported',
  '28P01': 'Database authentication failed',
  '28000': 'Database authorization failed',
  '3D000': 'Database does not exist',
  '3F000': 'Database schema does not exist',
  '42P01': 'Database relation does not exist',
  '42703': 'Database column does not exist',
  '42501': 'Insufficient database privileges',
  '23505': 'Database unique constraint violated',
  '23503': 'Database foreign key constraint violated',
  '23514': 'Database check constraint violated',
  '23P01': 'Database exclusion constraint violated',
  '40001': 'Database serialization failure',
  '40P01': 'Database deadlock detected',
  '53300': 'Database connection limit reached',
  '57P01': 'Database is shutting down',
  '57014': 'Database statement cancelled or timed out',
} as const;
const environmentFields = new Set(Object.keys(environmentSchema.shape));
const schemaRevisions = new Set([
  '001-tenant-authentication-v3',
  '002-appointment-scheduling-v1',
  expectedSchemaRevision,
]);

export interface ErrorDiagnostic {
  type: string;
  message: string;
  stack: string[];
  code?: string;
  validation_issues?: { field: string; code: string; requirement?: string }[];
  expected_revision?: string;
  actual_revision?: string;
  cause?: ErrorDiagnostic;
  errors?: ErrorDiagnostic[];
  truncated?: boolean;
}

const environmentRequirements: Readonly<Record<string, string>> = {
  IDEMPOTENCY_ENCRYPTION_KEY: 'Base64 encoding of exactly 32 bytes',
  OUTBOX_ENCRYPTION_KEY: 'Base64 encoding of exactly 32 bytes',
  OTP_HMAC_KEY: 'At least 32 characters',
  THROTTLE_HMAC_KEY: 'At least 32 characters',
  DATABASE_URL: 'Valid absolute database connection URL',
  PORT: 'Integer between 1 and 65535',
  AUTH_SESSION_TTL: 'ISO-8601 duration between PT15M and P7D',
};

function stackFrames(error: Error): string[] {
  if (
    typeof error.stack !== 'string' ||
    typeof error.message !== 'string' ||
    typeof error.name !== 'string' ||
    error.message.length > 32_768 ||
    error.name.length > 128
  )
    return [];
  const header = error.name
    ? error.message
      ? `${error.name}: ${error.message}`
      : error.name
    : error.message;
  if (!error.stack.startsWith(`${header}\n`)) return [];
  // Only locations from V8 frames: never the message, eval source, URLs or query strings.
  return error.stack
    .slice(header.length + 1, header.length + 1 + 32_768)
    .split('\n')
    .flatMap((line) => {
      const frame =
        /^\s+at (?:[\w.$<> -]{1,160} \()?((?:file:\/\/)?\/[^()\r\n?#]+|node:[\w/.-]+):(\d{1,7}):(\d{1,7})\)?$/.exec(
          line,
        );
      if (!frame) return [];
      const path = frame[1] ?? '';
      const location = path.startsWith('node:')
        ? path
        : /\/(src|dist|node_modules|test)\/(.+)$/.exec(path)?.slice(1).join('/');
      if (!location || location.length > 240 || !/^[\w@./+:-]+$/.test(location)) return [];
      return [`at ${location}:${frame[2] ?? ''}:${frame[3] ?? ''}`];
    })
    .slice(0, 20);
}

function errorType(error: Error): string {
  if (error instanceof ZodError) return 'ZodError';
  if (error instanceof SchemaCompatibilityError) return 'SchemaCompatibilityError';
  if (error instanceof AggregateError) return 'AggregateError';
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof ReferenceError) return 'ReferenceError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  return 'Error';
}

function describeError(
  error: unknown,
  state: { seen: Set<unknown>; remaining: number },
  depth = 0,
): ErrorDiagnostic {
  if (depth >= 5 || state.remaining-- <= 0 || state.seen.has(error))
    return { type: 'Error', message: 'Cause chain truncated', stack: [], truncated: true };
  if (!(error instanceof Error))
    return { type: 'NonError', message: 'A non-Error value was thrown', stack: [] };
  state.seen.add(error);
  const diagnostic: ErrorDiagnostic = {
    type: errorType(error),
    message: 'Unexpected error; inspect stack and cause',
    stack: stackFrames(error),
  };
  if (
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(technicalMessages, error.code)
  ) {
    diagnostic.code = error.code;
    diagnostic.message = technicalMessages[error.code as keyof typeof technicalMessages];
  }
  if (error instanceof ZodError) {
    diagnostic.code = 'INVALID_CONFIGURATION';
    diagnostic.message = 'Environment configuration is invalid';
    diagnostic.validation_issues = error.issues.slice(0, 32).flatMap((issue) => {
      const field = issue.path[0];
      return typeof field === 'string' && environmentFields.has(field)
        ? [
            {
              field,
              code: issue.code,
              ...(environmentRequirements[field]
                ? { requirement: environmentRequirements[field] }
                : {}),
            },
          ]
        : [];
    });
  }
  if (error instanceof SchemaCompatibilityError) {
    diagnostic.code = 'UNSUPPORTED_SCHEMA';
    diagnostic.message = 'Database schema is incompatible with this application';
    diagnostic.expected_revision = expectedSchemaRevision;
    diagnostic.actual_revision =
      typeof error.actualRevision === 'string' && schemaRevisions.has(error.actualRevision)
        ? error.actualRevision
        : 'unknown';
  }
  if (error.cause !== undefined) diagnostic.cause = describeError(error.cause, state, depth + 1);
  if (error instanceof AggregateError && Array.isArray(error.errors)) {
    diagnostic.errors = error.errors
      .slice(0, 5)
      .map((item: unknown) => describeError(item, state, depth + 1));
    if (error.errors.length > 5) diagnostic.truncated = true;
  }
  return diagnostic;
}

export function errorDiagnostic(error: unknown): ErrorDiagnostic {
  try {
    return describeError(error, { seen: new Set(), remaining: 16 });
  } catch {
    // An exception with a throwing accessor must not replace the original HTTP/startup failure.
    return { type: 'Error', message: 'Error diagnostic could not be inspected safely', stack: [] };
  }
}
