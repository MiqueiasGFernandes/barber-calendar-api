const sensitive = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'code',
  'access_token',
  'email',
  'administrator_email',
  'ip',
  'envelope_ciphertext',
]);
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitive.has(key.toLowerCase()) ? '[REDACTED]' : redact(item),
      ]),
    );
  return value;
}
export class JsonLogger {
  log(level: string, message: string, context: Readonly<Record<string, unknown>> = {}): void {
    process.stdout.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...(redact(context) as object) })}\n`,
    );
  }
}
