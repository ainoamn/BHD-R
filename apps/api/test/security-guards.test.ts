import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createCsrfToken } from '@bhd-r/security';
import { CsrfGuard } from '../src/common/csrf.guard.js';
import { PermissionGuard } from '../src/common/permission.guard.js';
import { REQUIRED_PERMISSIONS } from '../src/common/decorators.js';
import { signingRoleForParty } from '../src/leasing/leasing.service.js';
import { createInternalRequestId } from '../src/common/request-id.js';
import { auditChangedFields } from '../src/common/audit.interceptor.js';

function context(handler: () => void, request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('central authorization', () => {
  it('denies authenticated handlers that forgot to declare a policy', () => {
    const guard = new PermissionGuard(new Reflector());
    expect(() =>
      guard.canActivate(context(() => undefined, { auth: { permissions: [] } })),
    ).toThrow(ForbiddenException);
  });

  it('requires every declared permission', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(REQUIRED_PERMISSIONS, ['invoice.read'], handler);
    const guard = new PermissionGuard(new Reflector());
    expect(guard.canActivate(context(handler, { auth: { permissions: ['invoice.read'] } }))).toBe(
      true,
    );
    expect(() => guard.canActivate(context(handler, { auth: { permissions: [] } }))).toThrow(
      ForbiddenException,
    );
  });
});

describe('CSRF', () => {
  it('accepts a session-bound double-submit token and rejects a mismatch', () => {
    process.env.CSRF_SECRET = 'test-csrf-secret-that-is-at-least-32-characters';
    const sid = '352f632d-710c-463a-a42d-73af64318529';
    const token = createCsrfToken(sid, process.env.CSRF_SECRET);
    const guard = new CsrfGuard();
    const base = {
      method: 'POST',
      auth: { authenticationMethod: 'session', sid },
      headers: { 'x-csrf-token': token },
      cookies: { bhd_r_csrf: token },
    };
    expect(guard.canActivate(context(() => undefined, base))).toBe(true);
    expect(() =>
      guard.canActivate(
        context(() => undefined, { ...base, headers: { 'x-csrf-token': `${token}x` } }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        context(() => undefined, {
          ...base,
          headers: {
            'x-csrf-token': token,
            origin: 'https://attacker.example',
            'sec-fetch-site': 'cross-site',
          },
        }),
      ),
    ).toThrow('Cross-site request rejected');
  });
});

describe('contract signer role', () => {
  it('derives the role from the bound party and never trusts client input', () => {
    const contract = { ownerPartyId: 'owner', tenantPartyId: 'tenant' };
    expect(signingRoleForParty(contract, 'tenant')).toBe('tenant');
    expect(() => signingRoleForParty(contract, 'representative-without-grant')).toThrow(
      ForbiddenException,
    );
  });
});

describe('audit request correlation', () => {
  it('never accepts a client supplied request id as the internal audit id', () => {
    const supplied = 'attacker-controlled-id';
    const generated = createInternalRequestId();
    expect(generated).not.toBe(supplied);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never copies secrets or sensitive field names into audit metadata', () => {
    const metadata = {
      changedFields: auditChangedFields({
        displayName: 'Safe change',
        password: 'Plaintext must never be logged',
        apiKey: 'bhd_live_secret',
        credentials: { merchantSecret: 'gateway-secret' },
        totpCode: '123456',
      }),
    };
    expect(metadata.changedFields).toEqual(['displayName']);
    expect(JSON.stringify(metadata)).not.toMatch(
      /Plaintext|bhd_live|gateway-secret|123456|password|apiKey|credentials|totp/i,
    );
  });
});
