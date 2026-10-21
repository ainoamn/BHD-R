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
  'reservation.handover',
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
  'viewing.checkin',
  'sale.read',
  'sale.manage',
  'vendor.read',
  'vendor.manage',
  'work_order.read',
  'work_order.manage',
  'legal.read',
  'legal.manage',
  'legal.case.read',
  'legal.case.update',
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
  'admin_staff',
  'building_guard',
  'legal_counsel',
  'property_owner',
  'lawyer',
  'custom_member',
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
    'reservation.handover',
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
    'viewing.checkin',
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
    'reservation.handover',
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
    'viewing.checkin',
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
    'reservation.handover',
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
    'viewing.checkin',
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
    'task.read',
    'task.create',
    'task.assign',
    'task.update',
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
    'reservation.handover',
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
    'viewing.checkin',
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
  /** Front office: guests, viewings, requests and day-to-day bookings; no money or contracts. */
  admin_staff: [
    'organization.read',
    'party.read',
    'party.write',
    'property.read',
    'unit.read',
    'media.read',
    'prospect.read',
    'prospect.manage',
    'reservation.read',
    'reservation.handover',
    'viewing.read',
    'viewing.manage',
    'viewing.checkin',
    'request.read',
    'request.create',
    'request.update',
    'task.read',
    'task.create',
    'task.update',
    'contract.read',
    'lease.read',
    'invoice.read',
    'receipt.read',
    'maintenance.read',
    'maintenance.create',
    'stay.booking.read',
    'stay.booking.manage',
  ],
  /**
   * On-site guard: arrivals, viewing check-in, maintenance reports and daily tasks.
   * No org admin surfaces (notification templates, badges, portfolio editor, requests inbox).
   */
  building_guard: [
    'unit.read',
    'stay.booking.read',
    'reservation.handover',
    'viewing.read',
    'viewing.checkin',
    'maintenance.read',
    'maintenance.create',
    'task.read',
    'task.update',
  ],
  /** Contracts, templates, legal cases and cheque review; no payments or property changes. */
  legal_counsel: [
    'organization.read',
    'party.read',
    'property.read',
    'unit.read',
    'reservation.read',
    'contract.read',
    'contract.create',
    'contract.send',
    'contract.template.read',
    'contract.template.write',
    'lease.read',
    'invoice.read',
    'cheque.read',
    'cheque.review',
    'legal.read',
    'legal.manage',
    'approval.read',
    'report.read',
  ],
  /**
   * Owner of buildings the organization manages. Never org-wide: the session's party scopes
   * every read to properties whose owner party is theirs.
   */
  property_owner: [
    'organization.read',
    'property.read',
    'unit.read',
    'contract.read',
    'lease.read',
    'invoice.read',
    'receipt.read',
    'payment.read',
    'stay.booking.read',
    'viewing.read',
    'viewing.manage',
    'viewing.checkin',
    'maintenance.read',
    'request.read',
  ],
  /**
   * External lawyer or law firm. Never org-wide and never `legal.read`: the session's party
   * limits them to the cases whose lawyer party is theirs, read and updated through the web app.
   */
  lawyer: ['legal.case.read', 'legal.case.update'],
  /** Base of an organization's saved custom roles; their permissions come with the membership. */
  custom_member: ['organization.read'],
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

/** Membership role_key of an organization's own saved role: 'custom:<organization_roles.id>'. */
export const CUSTOM_ROLE_PREFIX = 'custom:';

export function customRoleKey(roleId: string): string {
  return `${CUSTOM_ROLE_PREFIX}${roleId}`;
}

type MembershipGrant = {
  roleKey: string;
  permissions: readonly string[];
  partyId?: string | null;
};

/** Saved-role ids among a member's rows, to load their permissions before building claims. */
export function customRoleIds(rows: readonly MembershipGrant[]): string[] {
  return rows
    .filter((row) => row.roleKey.startsWith(CUSTOM_ROLE_PREFIX))
    .map((row) => row.roleKey.slice(CUSTOM_ROLE_PREFIX.length));
}

/**
 * Roles, permissions and party a member's active rows grant in one organization. A saved role
 * contributes its current permissions (missing or archived roles contribute nothing).
 */
export function accessFromMemberships(
  rows: readonly MembershipGrant[],
  savedRolePermissions: ReadonlyMap<string, readonly string[]> = new Map(),
): { roles: RoleKey[]; permissions: Permission[]; partyId: string | null } {
  const roles = new Set<RoleKey>();
  const granted: string[] = [];
  for (const row of rows) {
    const builtIn = roleKeySchema.safeParse(row.roleKey);
    if (builtIn.success) roles.add(builtIn.data);
    else if (row.roleKey.startsWith(CUSTOM_ROLE_PREFIX)) {
      const saved = savedRolePermissions.get(row.roleKey.slice(CUSTOM_ROLE_PREFIX.length));
      if (saved) {
        roles.add('custom_member');
        granted.push(...saved);
      }
    }
    granted.push(...row.permissions);
  }
  const valid = granted.filter(
    (permission): permission is Permission => permissionSchema.safeParse(permission).success,
  );
  // A building owner's scope is their owner party, even when another row carries a party too.
  const partyId =
    rows.find((row) => row.roleKey === 'property_owner' && row.partyId)?.partyId ??
    rows.find((row) => row.roleKey === 'lawyer' && row.partyId)?.partyId ??
    rows.find((row) => row.partyId)?.partyId ??
    null;
  const roleList = [...roles];
  return {
    roles: roleList,
    permissions: [...new Set([...permissionsForRoles(roleList), ...valid])],
    partyId,
  };
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

/**
 * BHD-SESSION-POLICY: product session lives until explicit logout.
 * 400 days is the Chromium cookie ceiling, not an idle timeout.
 */
export const PRODUCT_SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

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
  return withCurrentRolePermissions(sessionClaimsSchema.parse(result.payload));
}

/** Permissions added to a built-in role reach sessions issued before that release. */
export function withCurrentRolePermissions(claims: SessionClaims): SessionClaims {
  const current = permissionsForRoles(claims.roles);
  if (current.every((permission) => claims.permissions.includes(permission))) return claims;
  return { ...claims, permissions: [...new Set([...claims.permissions, ...current])] };
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
