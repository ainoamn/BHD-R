import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function signature(nonce: string, sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${sessionId}.${nonce}`).digest('base64url');
}

export function createCsrfToken(sessionId: string, secret: string): string {
  const nonce = randomBytes(24).toString('base64url');
  return `${nonce}.${signature(nonce, sessionId, secret)}`;
}

export function verifyCsrfToken(token: string, sessionId: string, secret: string): boolean {
  const [nonce, supplied, extra] = token.split('.');
  if (!nonce || !supplied || extra) return false;
  const expected = signature(nonce, sessionId, secret);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
