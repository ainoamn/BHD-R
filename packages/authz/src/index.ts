import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
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
  'contract.read',
  'contract.create',
  'contract.send',
  'contract.sign',
  'contract.terminate',
  'lease.read',
  'lease.create',
  'lease.update',
  'lease.terminate',
  'invoice.read',
  'invoice.create',
  'invoice.void',
  'payment.read',
  'payment.record',
  'payment.refund',
  'payment.reconcile',
  'payment.gateway.read',
  'payment.gateway.write',
  'maintenance.read',
  'maintenance.create',
  'maintenance.assign',
  'maintenance.update',
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
    'property.read',
    'unit.read',
    'contract.read',
    'lease.read',
    'invoice.read',
    'payment.read',
    'maintenance.read',
    'report.read',
  ],
  organization_owner: [
    'organization.read',
    'organization.write',
    'organization.members.read',
    'organization.members.write',
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
    'contract.read',
    'contract.create',
    'contract.send',
    'contract.sign',
    'contract.terminate',
    'lease.read',
    'lease.create',
    'lease.update',
    'lease.terminate',
    'invoice.read',
    'invoice.create',
    'invoice.void',
    'payment.read',
    'payment.record',
    'payment.refund',
    'payment.reconcile',
    'payment.gateway.read',
    'payment.gateway.write',
    'maintenance.read',
    'maintenance.create',
    'maintenance.assign',
    'maintenance.update',
    'report.read',
    'report.export',
    'api_key.read',
    'api_key.write',
    'webhook.read',
    'webhook.write',
  ],
  organization_admin: [
    'organization.read',
    'organization.members.read',
    'organization.members.write',
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
    'contract.read',
    'contract.create',
    'contract.send',
    'lease.read',
    'lease.create',
    'lease.update',
    'invoice.read',
    'invoice.create',
    'payment.read',
    'payment.record',
    'payment.reconcile',
    'payment.gateway.read',
    'maintenance.read',
    'maintenance.create',
    'maintenance.assign',
    'maintenance.update',
    'report.read',
    'report.export',
    'api_key.read',
    'webhook.read',
  ],
  property_manager: [
    'organization.read',
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
    'contract.read',
    'contract.create',
    'contract.send',
    'lease.read',
    'lease.create',
    'lease.update',
    'invoice.read',
    'payment.read',
    'maintenance.read',
    'maintenance.create',
    'maintenance.assign',
    'maintenance.update',
    'report.read',
  ],
  finance_manager: [
    'organization.read',
    'property.read',
    'unit.read',
    'contract.read',
    'lease.read',
    'invoice.read',
    'invoice.create',
    'invoice.void',
    'payment.read',
    'payment.record',
    'payment.refund',
    'payment.reconcile',
    'payment.gateway.read',
    'payment.gateway.write',
    'report.read',
    'report.export',
  ],
  maintenance_agent: [
    'property.read',
    'unit.read',
    'maintenance.read',
    'maintenance.create',
    'maintenance.update',
  ],
  developer_admin: [
    'organization.read',
    'organization.members.read',
    'organization.members.write',
    'property.read',
    'property.create',
    'property.update',
    'unit.read',
    'unit.create',
    'unit.update',
    'unit.publish',
    'media.read',
    'media.create',
    'developer.project.read',
    'developer.project.write',
    'report.read',
    'report.export',
  ],
  tenant: [
    'contract.read',
    'contract.sign',
    'lease.read',
    'invoice.read',
    'payment.read',
    'maintenance.read',
    'maintenance.create',
    'tenant.profile.read',
    'tenant.profile.update',
  ],
  auditor: [
    'organization.read',
    'property.read',
    'unit.read',
    'contract.read',
    'lease.read',
    'invoice.read',
    'payment.read',
    'maintenance.read',
    'report.read',
    'report.export',
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

export async function verifyIdentityToken(input: {
  token: string;
  issuer: string;
  clientId: string;
  expectedNonce?: string;
  /** Temporary HS256 secret while ONE-BHD JWKS/RS256 is not active. */
  sharedSecret?: string;
  /** Override JWKS URI; defaults to `{issuer}/oauth/jwks.json` per bhd-identity.v1. */
  jwksUri?: string;
}): Promise<{ subject: string; email?: string; emailVerified: boolean; name?: string }> {
  const issuer = input.issuer.replace(/\/$/, '');
  const verifyOptions = {
    issuer,
    audience: input.clientId,
  } as const;

  try {
    const jwks = createRemoteJWKSet(new URL(input.jwksUri ?? `${issuer}/oauth/jwks.json`));
    const { payload } = await jwtVerify(input.token, jwks, {
      ...verifyOptions,
      algorithms: ['RS256', 'ES256'],
    });
    return parseVerifiedIdentityClaims(payload, input.expectedNonce);
  } catch (jwksError) {
    const sharedSecret = input.sharedSecret?.trim();
    if (!sharedSecret) throw jwksError;
    const { payload } = await jwtVerify(input.token, new TextEncoder().encode(sharedSecret), {
      ...verifyOptions,
      algorithms: ['HS256'],
    });
    return parseVerifiedIdentityClaims(payload, input.expectedNonce);
  }
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
