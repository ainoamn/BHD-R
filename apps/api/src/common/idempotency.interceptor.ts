import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { idempotencyKeys } from '@bhd-r/db';
import { idempotencyKeySchema } from '@bhd-r/contracts';
import type { ApiRequest, ApiResponse, AuthClaims } from './api-http.js';
import { IDEMPOTENT_ROUTE } from './decorators.js';
import { requestRoutePath } from './http-request.js';
import { DatabaseService } from '../database/database.service.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (
      !this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return next.handle();
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const reply = context.switchToHttp().getResponse<ApiResponse>();
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
    if (!keyResult.success)
      throw new UnprocessableEntityException('A valid Idempotency-Key is required');
    if (!request.auth?.organizationId)
      throw new UnprocessableEntityException('Organization context is required');
    const key = keyResult.data;
    const route = `${request.method}:${requestRoutePath(request)}`;
    const requestHash = createHash('sha256').update(stable(request.body)).digest('hex');

    return from(this.claim(request.auth, key, route, requestHash)).pipe(
      mergeMap((claimed) => {
        if (claimed.kind === 'replay') {
          reply.status(claimed.status);
          reply.setHeader('Idempotency-Replayed', 'true');
          return of(claimed.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(this.complete(request.auth!, key, route, reply.statusCode, body)).pipe(
              mergeMap(() => of(body)),
            ),
          ),
          catchError((error: unknown) =>
            from(this.release(request.auth!, key, route, requestHash)).pipe(
              mergeMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }

  private async claim(
    claims: AuthClaims,
    key: string,
    route: string,
    requestHash: string,
  ): Promise<{ kind: 'new' } | { kind: 'replay'; status: number; body: unknown }> {
    return this.database.withinTenant(claims, async (transaction) => {
      const now = new Date();
      const inserted = await transaction
        .insert(idempotencyKeys)
        .values({
          organizationId: claims.organizationId!,
          key,
          route,
          requestHash,
          lockedUntil: new Date(now.getTime() + 30_000),
          expiresAt: new Date(now.getTime() + 86_400_000),
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) return { kind: 'new' };
      const existing = await transaction.query.idempotencyKeys.findFirst({
        where: and(
          eq(idempotencyKeys.organizationId, claims.organizationId!),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.route, route),
        ),
      });
      if (!existing || existing.requestHash !== requestHash)
        throw new UnprocessableEntityException('Idempotency key was used with another payload');
      if (existing.responseStatus !== null)
        return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
      if (existing.lockedUntil <= now) {
        const reclaimed = await transaction
          .update(idempotencyKeys)
          .set({ lockedUntil: new Date(now.getTime() + 30_000) })
          .where(
            and(
              eq(idempotencyKeys.organizationId, claims.organizationId!),
              eq(idempotencyKeys.key, key),
              eq(idempotencyKeys.route, route),
              eq(idempotencyKeys.requestHash, requestHash),
              lt(idempotencyKeys.lockedUntil, now),
            ),
          )
          .returning({ key: idempotencyKeys.key });
        if (reclaimed.length > 0) return { kind: 'new' };
      }
      throw new ConflictException('An equivalent request is still being processed');
    });
  }

  private async complete(
    claims: AuthClaims,
    key: string,
    route: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.database.withinTenant(claims, async (transaction) => {
      await transaction
        .update(idempotencyKeys)
        .set({ responseStatus: status, responseBody: body })
        .where(
          and(
            eq(idempotencyKeys.organizationId, claims.organizationId!),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.route, route),
          ),
        );
    });
  }

  private async release(
    claims: AuthClaims,
    key: string,
    route: string,
    requestHash: string,
  ): Promise<void> {
    await this.database.withinTenant(claims, async (transaction) => {
      await transaction
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.organizationId, claims.organizationId!),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.route, route),
            eq(idempotencyKeys.requestHash, requestHash),
          ),
        );
    });
  }
}
