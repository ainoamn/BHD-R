import { randomUUID } from 'node:crypto';

export function createInternalRequestId(): string {
  return randomUUID();
}
