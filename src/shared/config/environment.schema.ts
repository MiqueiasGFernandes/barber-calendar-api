import { z } from 'zod';

const durationPattern = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
export function durationSeconds(value: string): number {
  const match = durationPattern.exec(value);
  if (!match || !match.slice(1).some(Boolean)) throw new Error('invalid ISO-8601 duration');
  return (
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0)
  );
}
const sessionTtl = z
  .string()
  .default('PT24H')
  .transform((value, context) => {
    try {
      const seconds = durationSeconds(value);
      if (seconds < 900 || seconds > 604800) throw new Error('must be between PT15M and P7D');
      return seconds;
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'invalid duration',
      });
      return z.NEVER;
    }
  });
const base64Key = z.string().transform((value, context) => {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    context.addIssue({ code: 'custom', message: 'must decode to 32 bytes' });
    return z.NEVER;
  }
  return key;
});

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
  AUTH_SESSION_TTL: sessionTtl,
  OTP_HMAC_KEY: z.string().min(32),
  THROTTLE_HMAC_KEY: z.string().min(32),
  OUTBOX_ENCRYPTION_KEY: base64Key,
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_KEY_ID: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  EMAIL_PROVIDER: z.enum(['mailpit', 'brevo']).default('mailpit'),
  MAILPIT_BASE_URL: z.url().default('http://localhost:8025'),
  BREVO_API_KEY: z.string().optional(),
});
export type Environment = z.infer<typeof environmentSchema>;
export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(source);
}
