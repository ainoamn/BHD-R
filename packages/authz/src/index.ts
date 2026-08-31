import { timingSafeEqual } from 'node:crypto';
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from 'jose';
import { z } from 'zod';

export const permissions = [
  'platform.settings.read',
  'platform.settings.write',
  'platform.audit.read',
  'platform.cms.write',
  'organization.read',
  'organization.write',
  'organization.members.read',
  'organization.members.write',
  'party.read',
  'party.write',
  'party.sensitive.read',
  'party.representative.manage',
  'property.read',
  'property.create',
  'property.update',
  'property.archive',
  'unit.read',
  'unit.create',
  'unit.update',
  'unit.publish',
  'unit.availability.manage',
  'media.read',
  'media.create',
  'media.delete',
  'prospect.read',
  'prospect.manage',
  'reservation.read',
  'reservation.manage',
  'reservation.document.submit',
  'contract.read',
  'contract.create',
  'contract.template.read',
  'contract.template.write',
  'contract.send',
  'contract.sign',
  'contract.terminate',
  'lease.read',
  'lease.create',
  'lease.update',
  'lease.terminate',
  'lease.cancel.request',
  'lease.cancel.approve',
  'lease.cancel.clear',
  'lease.renew.confirm',
  'lease.renew.waive',
  'invoice.read',
  'invoice.create',
  'invoice.void',
  'billing.schedule.read',
  'billing.schedule.manage',
  'receipt.read',
  'payment.read',
  'payment.record',
  'payment.refund',
  'payment.reconcile',
  'payment.gateway.read',
  'payment.gateway.write',
  'finance.booking_payment.confirm',
  'cheque.read',
  'cheque.manage',
  'cheque.review',
  'maintenance.read',
  'maintenance.create',
  'maintenance.assign',
  'maintenance.update',
  'request.read',
  'request.create',
  'request.update',
  'task.read',
  'task.create',
  'task.assign',
  'task.update',
  'viewing.read',
  'viewing.manage',
  'sale.read',
  'sale.manage',
  'vendor.read',
  'vendor.manage',
  'work_order.read',
  'work_order.manage',
  'legal.read',
  'legal.manage',
  'accounting.read',
  'accounting.manage',
  'accounting.post',
  'approval.read',
  'approval.decide',
  'report.read',
  'report.export',
  'tenant.profile.read',
  'tenant.profile.update',
  'developer.project.read',
  'developer.project.write',
  'api_key.read',
  'api_key.write',
  'webhook.read',
  'webhook.write',
  'country_pack.read',
  'country_pack.write',
  'stay.inventory.manage',
  'stay.rate.manage',
  'stay.booking.read',
  'stay.booking.manage',
  'stay.refund.approve',
  'stay.review.moderate',
] as const;

export const permissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof permissionSchema>;

export const roleKeys = [
  'platform_admin',
  'platform_support',
  'organization_owner',
  'organization_admin',
  'property_manager',
  'finance_manager',
  'maintenance_agent',
  'developer_admin',
  'tenant',
  'auditor',
] as const;
export const roleKeySchema = z.enum(roleKeys);
export type RoleKey = z.infer<typeof roleKeySchema>;

const allPermissions = [...permissions];
export const rolePermissions: Readonly<Record<RoleKey, readonly Permission[]>> = {
  platform_admin: allPermissions,
  platform_support: [
    'platform.settings.read',
    'platform.audit.read',
    'organization.read',
    'party.read',
    'property.read',
    'unit.read',
    'contract.read',
    'lease.read',
    'invoice.read',
    'payment.read',
    'maintenance.read',
    'request.read',
    'task.read',
    'viewing.read',
    'sale.read',
    'vendor.read',
    'work_order.read',
    'legal.read',
    'accounting.read',
    'approval.read',
    'report.read',
  ],
  organization_owner: [
    'organization.read',
    'organization.write',
    'organization.members.read',
    'organization.members.write',
    'party.read',
    'party.write',
    'party.sensitive.read',
    'party.representative.manage',
    'property.read',
    'property.create',
    'property.update',
    'property.archive',
    'unit.read',
    'unit.create',
    'unit.update',
    'unit.publish',
    'unit.availability.manage',
    'media.read',
    'media.create',
    'media.delete',
    'prospect.read',
    'prospect.manage',
    'reservation.read',
    'reservation.manage',
    'reservation.document.submit',
    'contract.read',
    'contract.create',
    'contract.template.read',
    'contract.template.write',
    'contract.send',
    'contract.sign',
    'contract.terminate',
    'lease.read',
    'lease.create',
    'lease.update',
    'lease.terminate',
    'lease.cancel.request',
    'lease.cancel.approve',
    'lease.cancel.clear',
    'lease.renew.confirm',
    'lease.renew.waive',
    'invoice.read',
    'invoice.create',
    'invoice.void',
    'billing.schedule.read',
    'billing.schedule.manage',
    'receipt.read',
    'payment.read',
    'payment.record',
    'payment.refund',
    'payment.reconcile',
    'payment.gateway.read',
    'payment.gateway.write',
    'finance.booking_payment.confirm',
    'cheque.read',
    'cheque.manage',
    'cheque.review',
    'maintenance.read',
    'maintenance.create',
    'maintenance.assign',
    'maintenance.update',
    'request.read',
    'request.create',
    'request.update',
    'task.read',
    'task.create',
    'task.assign',
    'task.update',
    'viewing.read',
    'viewing.manage',
    'sale.read',
    'sale.manage',
    'vendor.read',
    'vendor.manage',
    'work_order.read',
    'work_order.manage',
    'legal.read',
    'legal.manage',
    'accounting.read',
    'accounting.manage',
    'accounting.post',
    'approval.read',
    'approval.decide',
    'report.read',
    'report.export',
    'api_key.read',
    'api_key.write',
    'webhook.read',
    'webhook.write',
    'stay.inventory.manage',
    'stay.rate.manage',
    'stay.booking.read',
    'stay.booking.manage',
    'stay.refund.approve',
    'stay.review.moderate',
  ],
  organization_admin: [
    'organization.read',
    'organization.members.read',
    'organization.members.write',
    'party.read',
    'party.write',
    'party.sensitive.read',
    'party.representative.manage',
    'property.read',
    'property.create',
    'property.update',
    'unit.read',
    'unit.create',
    'unit.update',
    'unit.publish',
    'unit.availability.manage',
    'media.read',
    'media.create',
    'media.delete',
    'prospect.read',
    'prospect.manage',
    'reservation.read',
    'reservation.manage',
    'reservation.document.submit',
    'contract.read',
    'contract.create',
    'contract.template.read',
    'contract.template.write',
    'contract.send',
    'lease.read',
    'lease.create',
    'lease.update',
    'lease.cancel.request',
    'lease.cancel.approve',
    'lease.cancel.clear',
    'lease.renew.confirm',
    'invoice.read',
    'invoice.create',
    'billing.schedule.read',
    'billing.schedule.manage',
    'receipt.read',
    'payment.read',
    'payment.record',
    'payment.reconcile',
    'payment.gateway.read',
    'finance.booking_payment.confirm',
    'cheque.read',
    'cheque.manage',
    'cheque.review',
    'maintenance.read',
    'maintenance.create',
    'maintenance.assign',
    'maintenance.update',
    'request.read',
    'request.create',
    'request.update',
    'task.read',
    'task.create',
    'task.assign',
    'task.update',
    'viewing.read',
    'viewing.manage',
    'sale.read',
    'sale.manage',
    'vendor.read',
    'vendor.manage',
    'work_order.read',
    'work_order.manage',
    'legal.read',
    'legal.manage',
    'accounting.read',
    'accounting.manage',
    'accounting.post',
    'approval.read',
    'approval.decide',
    'report.read',
    'report.export',
    'api_key.read',
    'webhook.read',
    'stay.inventory.manage',
    'stay.rate.manage',
    'stay.booking.read',
    'stay.booking.manage',
    'stay.review.moderate',
  ],
  property_manager: [
    'organization.read',
    'party.read',
    'party.write',
    'party.sensitive.read',
    'party.representative.manage',
    'property.read',
    'property.create',
    'property.update',
    'unit.read',
    'unit.create',
    'unit.update',
    'unit.publish',
    'unit.availability.manage',
    'media.read',
    'media.create',
    'media.delete',
    'prospect.read',
    'prospect.manage',
    'reservation.read',
    'reservation.manage',
    'reservation.document.submit',
    'contract.read',
    'contract.create',
    'contract.template.read',
    'contract.send',
    'lease.read',
    'lease.create',
    'lease.update',
    'lease.cancel.request',
    'lease.cancel.approve',
    'lease.renew.waive',
    'invoice.read',
    'billing.schedule.read',
    'billing.schedule.manage',
    'receipt.read',
    'payment.read',
    'maintenance.read',
    'maintenance.create',
    'maintenance.assign',
    'maintenance.update',
    'request.read',
    'request.create',
    'request.update',
    'task.read',
    'task.create',
    'task.assign',
    'task.update',
    'viewing.read',
    'viewing.manage',
    'sale.read',
    'sale.manage',
    'vendor.read',
    'vendor.manage',
    'work_order.read',
    'work_order.manage',
    'legal.read',
    'accounting.read',
    'approval.read',
    'report.read',
    'stay.inventory.manage',
    'stay.rate.manage',
    'stay.booking.read',
    'stay.booking.manage',
    'stay.review.moderate',
  ],
  finance_manager: [
    'organization.read',
    'party.read',
    'property.read',
    'unit.read',
    'contract.read',
    'lease.read',
    'lease.cancel.clear',
    'lease.renew.confirm',
    'invoice.read',
    'invoice.create',
    'invoice.void',
    'billing.schedule.read',
    'billing.schedule.manage',
    'receipt.read',
    'payment.read',
    'payment.record',
    'payment.refund',
    'payment.reconcile',
    'payment.gateway.read',
    'payment.gateway.write',
    'finance.booking_payment.confirm',
    'cheque.read',
    'cheque.manage',
    'cheque.review',
    'sale.read',
    'vendor.read',
    'work_order.read',
    'legal.read',
    'accounting.read',
    'accounting.manage',
    'accounting.post',
    'approval.read',
    'approval.decide',
    'report.read',
    'report.export',
    'stay.booking.read',
    'stay.refund.approve',
  ],
  maintenance_agent: [
    'property.read',
    'unit.read',
    'maintenance.read',
    'maintenance.create',
    'maintenance.update',
    'request.read',
    'request.update',
    'task.read',
    'task.update',
    'vendor.read',
    'work_order.read',
    'work_order.manage',
  ],
  developer_admin: [
    'organization.read',
    'organization.members.read',
    'organization.members.write',
    'party.read',
    'party.write',
    'party.sensitive.read',
    'party.representative.manage',
    'property.read',
    'property.create',
    'property.update',
    'unit.read',
    'unit.create',
    'unit.update',
    'unit.publish',
    'media.read',
    'media.create',
    'prospect.read',
    'prospect.manage',
    'reservation.read',
    'reservation.manage',
    'reservation.document.submit',
    'contract.read',
    'contract.create',
    'contract.send',
    'lease.read',
    'lease.create',
    'lease.update',
    'lease.cancel.request',
    'lease.cancel.approve',
    'invoice.read',
    'invoice.create',
    'payment.read',
    'payment.record',
    'maintenance.read',
    'maintenance.create',
    'maintenance.assign',
    'maintenance.update',
    'request.read',
    'request.create',
    'request.update',
    'task.read',
    'task.create',
    'task.assign',
    'task.update',
    'viewing.read',
    'viewing.manage',
    'sale.read',
    'sale.manage',
    'vendor.read',
    'vendor.manage',
    'work_order.read',
    'work_order.manage',
    'legal.read',
    'legal.manage',
    'accounting.read',
    'accounting.manage',
    'accounting.post',
    'contract.template.read',
    'contract.template.write',
    'billing.schedule.read',
    'billing.schedule.manage',
    'receipt.read',
    'approval.read',
    'approval.decide',
    'developer.project.read',
    'developer.project.write',
    'report.read',
    'report.export',
  ],
  tenant: [
    'reservation.read',
    'reservation.document.submit',
    'contract.read',
    'contract.sign',
    'lease.read',
    'lease.cancel.request',
    'invoice.read',
    'receipt.read',
    'payment.read',
    'maintenance.read',
    'maintenance.create',
    'request.read',
    'request.create',
    'tenant.profile.read',
    'tenant.profile.update',
  ],
  auditor: [
    'organization.read',
    'party.read',
    'property.read',
    'unit.read',
    'reservation.read',
    'contract.read',
    'lease.read',
    'invoice.read',
    'billing.schedule.read',
    'receipt.read',
    'payment.read',
    'maintenance.read',
    'request.read',
    'task.read',
    'viewing.read',
    'sale.read',
    'vendor.read',
    'work_order.read',
    'legal.read',
    'accounting.read',
    'approval.read',
    'report.read',
    'report.export',
    'stay.booking.read',
  ],
};

export const sessionClaimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  partyId: z.string().uuid().nullable(),
  roles: z.array(roleKeySchema),
  permissions: z.array(permissionSchema),
  locale: z.enum(['ar', 'en']),
  sessionVersion: z.number().int().nonnegative(),
});
export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

export function permissionsForRoles(roles: readonly RoleKey[]): Permission[] {
  return [...new Set(roles.flatMap((role) => rolePermissions[role]))];
}

export function hasPermission(claims: SessionClaims, permission: Permission): boolean {
  return claims.permissions.includes(permission);
}

/** Central policy decision helper used by guards and domain services. */
export function can(
  actor: SessionClaims,
  action: Permission,
  _resource?: { organizationId?: string; type?: string; id?: string },
  tenantContext?: { organizationId?: string },
): boolean {
  const isPlatformAdmin = actor.roles.includes('platform_admin');
  if (
    tenantContext?.organizationId &&
    actor.organizationId &&
    tenantContext.organizationId !== actor.organizationId &&
    !isPlatformAdmin
  ) {
    return false;
  }
  if (
    _resource?.organizationId &&
    actor.organizationId &&
    _resource.organizationId !== actor.organizationId &&
    !isPlatformAdmin
  ) {
    return false;
  }
  return hasPermission(actor, action);
}

export async function issueSessionToken(
  claims: SessionClaims,
  secret: Uint8Array,
  ttlSeconds = 900,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('bhd-r')
    .setAudience('bhd-r-api')
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
  secret: Uint8Array,
): Promise<SessionClaims> {
  const result = await jwtVerify(token, secret, {
    issuer: 'bhd-r',
    audience: 'bhd-r-api',
    algorithms: ['HS256'],
  });
  return sessionClaimsSchema.parse(result.payload);
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error('unknown_error');
  }
}

export async function verifyIdentityToken(input: {
  token: string;
  issuer: string;
  clientId: string;
  expectedNonce?: string;
  /** Temporary HS256 secret while ONE-BHD JWKS/RS256 is not active. */
  sharedSecret?: string;
  /** Override JWKS URI; defaults to `{issuer}/oauth/jwks.json` per bhd-identity.v1. */
  jwksUri?: string;
  /** Bearer access token — used for /oauth/userinfo fallback (Nasab/WAZEN pattern). */
  accessToken?: string;
}): Promise<{ subject: string; email?: string; emailVerified: boolean; name?: string }> {
  const issuer = input.issuer.replace(/\/$/, '');
  const verifyOptions = {
    issuer,
    audience: input.clientId,
  } as const;
  const header = decodeProtectedHeader(input.token);
  const alg = header.alg;

  let payload: JWTPayload;
  if (alg === 'RS256' || alg === 'ES256') {
    const jwks = createRemoteJWKSet(new URL(input.jwksUri ?? `${issuer}/oauth/jwks.json`));
    ({ payload } = await jwtVerify(input.token, jwks, {
      ...verifyOptions,
      algorithms: ['RS256', 'ES256'],
    }));
  } else if (alg === 'HS256') {
    const sharedSecret = input.sharedSecret
      ?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim();
    let verified: JWTPayload | undefined;
    let hs256Error: unknown;
    if (sharedSecret) {
      try {
        ({ payload: verified } = await jwtVerify(
          input.token,
          new TextEncoder().encode(sharedSecret),
          {
            ...verifyOptions,
            algorithms: ['HS256'],
            clockTolerance: 30,
          },
        ));
      } catch (error) {
        hs256Error = error;
      }
    }
    if (verified) {
      payload = verified;
    } else if (input.accessToken) {
      // Acceptable fallback after PKCE code exchange (Nasab/WAZEN / bhd-identity.v1).
      try {
        payload = await claimsFromUserinfo(issuer, input.accessToken, input.token);
      } catch (userinfoError) {
        if (hs256Error) throw toError(hs256Error);
        throw toError(userinfoError);
      }
    } else if (hs256Error) {
      throw toError(hs256Error);
    } else {
      throw new Error('missing_hs256_secret');
    }
  } else {
    throw new Error(`unsupported_id_token_alg:${alg ?? 'unknown'}`);
  }

  return parseVerifiedIdentityClaims(payload, input.expectedNonce);
}

async function claimsFromUserinfo(
  issuer: string,
  accessToken: string,
  idToken: string,
): Promise<JWTPayload> {
  const decoded = decodeJwt(idToken);
  const response = await fetch(`${issuer.replace(/\/$/, '')}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('userinfo_failed');
  const info = z
    .object({
      sub: z.string().min(1),
      email: z.union([z.string(), z.null()]).optional(),
      email_verified: z.union([z.boolean(), z.null()]).optional(),
      name: z.union([z.string(), z.null()]).optional(),
    })
    .parse(await response.json());
  if (info.sub !== decoded.sub) throw new Error('userinfo_sub_mismatch');
  return {
    ...decoded,
    sub: info.sub,
    ...(typeof info.email === 'string' && info.email.includes('@') ? { email: info.email } : {}),
    email_verified: info.email_verified === true,
    ...(typeof info.name === 'string' ? { name: info.name } : {}),
  };
}

function sameSecretValue(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function parseVerifiedIdentityClaims(
  payload: JWTPayload,
  expectedNonce?: string,
): { subject: string; email?: string; emailVerified: boolean; name?: string } {
  if (
    expectedNonce !== undefined &&
    (typeof payload.nonce !== 'string' || !sameSecretValue(payload.nonce, expectedNonce))
  ) {
    throw new Error('OIDC nonce validation failed');
  }

  return {
    subject: z.string().min(1).parse(payload.sub),
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    emailVerified: payload.email_verified === true,
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
  };
}
