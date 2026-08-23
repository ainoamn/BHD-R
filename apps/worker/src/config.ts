import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  DATABASE_URL: z.string().min(1),
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_PRIVATE: z.string().min(3),
  S3_BUCKET_PUBLIC: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(8),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  MEDIA_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 1024 * 1024),
  MEDIA_SCAN_MODE: z.enum(['required', 'best-effort', 'disabled']).default('required'),
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CHROMIUM_EXECUTABLE_PATH: z.string().default('/usr/bin/chromium'),
  SMTP_HOST: z.string().default('mailpit'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  EMAIL_FROM: z.string().email().default('no-reply@bhd-om.com'),
  FIELD_ENCRYPTION_KEY_V1: z.string().min(32),
  FIELD_ENCRYPTION_ACTIVE_VERSION: z
    .string()
    .regex(/^v\d+$/)
    .default('v1'),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid worker environment fields: ${fields}`);
  }
  return result.data;
}
