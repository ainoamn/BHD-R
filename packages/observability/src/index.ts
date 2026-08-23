const secretKeyPattern =
  /(?:authorization|cookie|set-cookie|password|passcode|secret|token|jwt|(?:^|[-_])key(?:$|[-_])|api[-_]?key|private[-_]?key|signature|totp|otp|cvv|card[-_]?number|client[-_]?secret|credential|plaintext)/i;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const emailPattern = /([\w.+-]{1,3})[\w.+-]*(@[\w.-]+\.[A-Za-z]{2,})/g;

export const REDACTED = '[REDACTED]';

export function sanitizeText(value: string): string {
  return value
    .replace(bearerPattern, `Bearer ${REDACTED}`)
    .replace(jwtPattern, REDACTED)
    .replace(emailPattern, '$1***$2');
}

export function sanitizeForAudit(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForAudit(item, seen));

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = secretKeyPattern.test(key) ? REDACTED : sanitizeForAudit(child, seen);
  }
  return output;
}

export interface AuditRecord {
  action: string;
  actorId: string | null;
  organizationId: string | null;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  ipHash: string | null;
  metadata: unknown;
  occurredAt: string;
}

export function createAuditRecord(
  input: Omit<AuditRecord, 'metadata' | 'occurredAt'> & { metadata?: unknown },
): AuditRecord {
  return {
    ...input,
    metadata: sanitizeForAudit(input.metadata ?? {}),
    occurredAt: new Date().toISOString(),
  };
}
