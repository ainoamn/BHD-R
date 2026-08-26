import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { createAuditRecord } from '@bhd-r/observability';
import { auditLogs } from '@bhd-r/db';
import { DatabaseService } from '../database/database.service.js';
import { createHash } from 'node:crypto';
import type { ApiRequest } from './api-http.js';
import { requestIdOf, requestRoutePath } from './http-request.js';

const sensitiveAuditField =
  /(?:password|passphrase|secret|token|authorization|cookie|credential|api[-_]?key|totp|signature|card|cvv|national[-_]?id|civil[-_]?id|registration[-_]?number)/i;

export function auditChangedFields(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body)
    .filter((field) => !sensitiveAuditField.test(field))
    .slice(0, 50);
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  readonly #logger = new Logger(AuditInterceptor.name);
  constructor(private readonly database: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next.handle();
    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => void this.record(request, 'succeeded', started),
        error: () => void this.record(request, 'failed', started),
      }),
    );
  }

  private async record(request: ApiRequest, outcome: string, started: number): Promise<void> {
    try {
      const path = requestRoutePath(request);
      const record = createAuditRecord({
        action: `${request.method} ${path}`,
        actorId: request.auth?.sub ?? null,
        organizationId: request.auth?.organizationId ?? null,
        resourceType: path.split('/')[2] ?? 'api',
        resourceId:
          typeof (request.params as Record<string, unknown> | undefined)?.id === 'string'
            ? String((request.params as Record<string, unknown>).id)
            : null,
        requestId: requestIdOf(request),
        ipHash: createHash('sha256').update(request.ip ?? '').digest('hex'),
        metadata: {
          outcome,
          durationMs: Date.now() - started,
          requiredPermissions: request.requiredPermissions,
          changedFields: auditChangedFields(request.body),
        },
      });
      await this.database.asSystem(async (transaction) => {
        await transaction
          .insert(auditLogs)
          .values({
            organizationId: record.organizationId,
            actorUserId: record.actorId,
            action: record.action,
            resourceType: record.resourceType,
            resourceId: record.resourceId,
            requestId: record.requestId,
            ipHash: record.ipHash,
            metadata: record.metadata,
            occurredAt: new Date(record.occurredAt),
          })
          .onConflictDoNothing();
      });
    } catch (error) {
      this.#logger.error(
        `Unable to persist audit record (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
    }
  }
}
