import { z } from 'zod';

const optionalUrl = z.union([z.url(), z.literal('')]).optional();

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  API_ORIGIN: z.url().default('http://localhost:4000'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url(),
  /** Must be redis:// or rediss:// — not an Upstash console HTTPS page. */
  REDIS_URL: z
    .string()
    .min(1)
    .refine(
      (value) => /^rediss?:\/\//i.test(value),
      'REDIS_URL must start with redis:// or rediss:// (Upstash REST/console URLs are invalid)',
    ),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET_PRIVATE: z.string().min(3),
  S3_BUCKET_PUBLIC: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(3),
  S3_SECRET_KEY: z.string().min(8),
  BHD_IDENTITY_ISSUER: z.url(),
  BHD_IDENTITY_CLIENT_ID: z.string().min(2),
  BHD_IDENTITY_CLIENT_SECRET: z.string().min(8),
  BHD_IDENTITY_REDIRECT_URI: z.url(),
  BHD_R_SESSION_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY_V1: z.string().min(32),
  FIELD_ENCRYPTION_ACTIVE_VERSION: z
    .string()
    .regex(/^v\d+$/)
    .default('v1'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(8),
  CSRF_SECRET: z.string().min(32),
  PUBLIC_PROPERTY_BASE_URL: z.url(),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  SENTRY_DSN: optionalUrl,
  /**
   * BHD R Stays — platform kill-switch. Default off.
   * Org/property/unit layers: see feature-flags.ts / STAYS_ORG_ALLOWLIST.
   */
  STAYS_PLATFORM_ENABLED: z
    .enum(['0', '1', 'true', 'false', 'yes', 'no', 'on', 'off'])
    .optional()
    .default('false'),
  /** Comma-separated organization UUIDs (or `*`) when platform flag is on. */
  STAYS_ORG_ALLOWLIST: z.string().optional().default(''),
});

export type Environment = z.infer<typeof environmentSchema>;

/** Resolved BHD Identity settings — aliases match ONE-BHD `docs/BHD-IDENTITY-SSO.md`. */
export function resolveIdentitySettings(source: NodeJS.ProcessEnv = process.env) {
  const issuer = (source.BHD_IDENTITY_ISSUER ?? 'https://id.bhd-om.com').replace(/\/$/, '');
  const clientId = source.BHD_OAUTH_CLIENT_ID ?? source.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r';
  const clientSecret = source.BHD_OAUTH_CLIENT_SECRET ?? source.BHD_IDENTITY_CLIENT_SECRET ?? '';
  const redirectUri =
    source.BHD_OAUTH_REDIRECT_URI ??
    source.BHD_IDENTITY_REDIRECT_URI ??
    'http://localhost:3000/v1/auth/oidc/callback';
  const tokenSecret = source.BHD_IDENTITY_TOKEN_SECRET ?? source.IDENTITY_TOKEN_SECRET ?? '';
  return { issuer, clientId, clientSecret, redirectUri, tokenSecret };
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const normalized: NodeJS.ProcessEnv = {
    ...source,
    BHD_IDENTITY_CLIENT_ID: source.BHD_IDENTITY_CLIENT_ID ?? source.BHD_OAUTH_CLIENT_ID,
    BHD_IDENTITY_CLIENT_SECRET: source.BHD_IDENTITY_CLIENT_SECRET ?? source.BHD_OAUTH_CLIENT_SECRET,
    BHD_IDENTITY_REDIRECT_URI: source.BHD_IDENTITY_REDIRECT_URI ?? source.BHD_OAUTH_REDIRECT_URI,
  };
  const result = environmentSchema.safeParse(normalized);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return result.data;
}

export {
  readStaysFlagsFromEnv,
  resolveStaysEnabled,
  resolveStaysEnabledFromEnv,
  staysPublicSurfaceEnabled,
  type StaysFlagResolution,
  type StaysFlagScope,
} from './feature-flags.js';
