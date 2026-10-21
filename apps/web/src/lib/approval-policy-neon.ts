import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  accessFromMemberships,
  customRoleIds,
  hasPermission,
  type Permission,
  type SessionClaims,
} from '@bhd-r/authz';
import { memberships, properties, stayPolicies, stayProfiles, units, users } from '@bhd-r/db';
import { loadSavedRolePermissions } from '@/lib/organization-roles-read';
import {
  DEFAULT_APPROVAL_POLICY,
  sanitizeApprovalPolicy,
  type ApprovalPolicy,
  type ApprovalPolicySource,
} from '@/lib/approval-policy';
import {
  applyMemberScope,
  getDatabase,
  withElevatedRead,
  type MemberScope,
  type Tx,
} from '@/lib/public-booking-neon';

const POLICY_KIND = 'other';
const ORGANIZATION_SCOPE = 'org';

/** Contract approval on the owner's behalf signs a contract, so whoever enables it must be able to. */
const CONTRACT_DELEGATE_PERMISSIONS: Permission[] = [
  'contract.create',
  'contract.sign',
  'lease.create',
];

function policyCode(propertyId: string | null) {
  return `approval_policy:${propertyId ?? ORGANIZATION_SCOPE}`;
}

/** The member who set the policy; automatic contract approval signs in their name. */
export type ApprovalDelegate = { userId: string; name: string | null };

export type StoredApprovalPolicy = {
  policy: ApprovalPolicy;
  delegate: ApprovalDelegate | null;
  updatedAt: string;
};

export type ResolvedApprovalPolicy = {
  source: ApprovalPolicySource;
  policy: ApprovalPolicy;
  delegate: ApprovalDelegate | null;
};

/** Caller must already be scoped to `organizationId`. */
export async function readApprovalPolicy(
  transaction: Tx,
  organizationId: string,
  propertyId: string | null,
): Promise<StoredApprovalPolicy | null> {
  const row = await transaction.query.stayPolicies.findFirst({
    where: and(
      eq(stayPolicies.organizationId, organizationId),
      eq(stayPolicies.kind, POLICY_KIND),
      eq(stayPolicies.code, policyCode(propertyId)),
      eq(stayPolicies.status, 'active'),
    ),
    orderBy: [desc(stayPolicies.version)],
    columns: { rulesJson: true, updatedAt: true },
  });
  if (!row) return null;
  const rules = (row.rulesJson ?? {}) as { policy?: unknown; delegate?: unknown };
  const delegate = rules.delegate as Partial<ApprovalDelegate> | undefined;
  return {
    policy: sanitizeApprovalPolicy(rules.policy),
    delegate:
      delegate && typeof delegate.userId === 'string'
        ? {
            userId: delegate.userId,
            name: typeof delegate.name === 'string' ? delegate.name : null,
          }
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Property override → organization policy → platform default (everything by hand except payment). */
export async function resolveApprovalPolicy(
  transaction: Tx,
  organizationId: string,
  propertyId: string,
): Promise<ResolvedApprovalPolicy> {
  return withElevatedRead(transaction, async () => {
    const own = await readApprovalPolicy(transaction, organizationId, propertyId);
    if (own) return { source: 'property' as const, policy: own.policy, delegate: own.delegate };
    const shared = await readApprovalPolicy(transaction, organizationId, null);
    if (shared) {
      return { source: 'organization' as const, policy: shared.policy, delegate: shared.delegate };
    }
    return { source: 'default' as const, policy: DEFAULT_APPROVAL_POLICY, delegate: null };
  });
}

export type OwnerApprovalPolicyView = {
  own: StoredApprovalPolicy | null;
  /** The organization policy a property inherits; null on the organization page itself. */
  inherited: { source: ApprovalPolicySource; policy: ApprovalPolicy } | null;
};

export async function loadOwnerApprovalPolicy(
  scope: MemberScope,
  propertyId: string | null,
): Promise<OwnerApprovalPolicyView> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyMemberScope(transaction, scope);
    const own = await readApprovalPolicy(transaction, scope.organizationId, propertyId);
    if (!propertyId) return { own, inherited: null };
    const shared = await readApprovalPolicy(transaction, scope.organizationId, null);
    return {
      own,
      inherited: shared
        ? { source: 'organization', policy: shared.policy }
        : { source: 'default', policy: DEFAULT_APPROVAL_POLICY },
    };
  });
}

/**
 * Saves the policy for a property (`propertyId`) or the whole organization (null).
 * `policy` null removes the override: a property falls back to the organization, the
 * organization to the platform default.
 */
export async function saveApprovalPolicy(
  claims: SessionClaims,
  propertyId: string | null,
  policy: ApprovalPolicy | null,
): Promise<{ policy: ApprovalPolicy | null; delegateName: string | null }> {
  const organizationId = claims.organizationId;
  if (!organizationId) throw new Error('organization_required');
  if (!hasPermission(claims, 'reservation.manage')) throw new Error('forbidden');
  if (
    policy?.contract === 'auto' &&
    !CONTRACT_DELEGATE_PERMISSIONS.every((permission) => hasPermission(claims, permission))
  ) {
    throw new Error('approval_delegate_forbidden');
  }
  const code = policyCode(propertyId);
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyMemberScope(transaction, {
      organizationId,
      userId: claims.sub,
      partyId: claims.partyId,
      roles: claims.roles,
    });
    if (propertyId) {
      const property = await transaction.query.properties.findFirst({
        where: and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
        columns: { id: true, status: true },
      });
      if (!property) throw new Error('property_not_found');
      if (property.status === 'archived') throw new Error('property_archived');
    }
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${code}`}))`,
    );
    await transaction
      .update(stayPolicies)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, code),
          eq(stayPolicies.status, 'active'),
        ),
      );
    if (!policy) return { policy: null, delegateName: null };

    const [latest] = await transaction
      .select({ version: sql<number>`coalesce(max(${stayPolicies.version}), 0)::int` })
      .from(stayPolicies)
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, code),
        ),
      );
    const [viewer] = await transaction
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const clean = sanitizeApprovalPolicy(policy);
    await transaction.insert(stayPolicies).values({
      organizationId,
      kind: POLICY_KIND,
      code,
      nameAr: propertyId ? 'سياسة اعتماد الحجوزات — عقار' : 'سياسة اعتماد الحجوزات — المؤسسة',
      nameEn: propertyId ? 'Booking approval policy — property' : 'Booking approval policy',
      version: (latest?.version ?? 0) + 1,
      rulesJson: {
        scope: 'approval_policy',
        propertyId,
        policy: clean,
        delegate: { userId: claims.sub, name: viewer?.name ?? null },
        updatedByUserId: claims.sub,
      },
      status: 'active',
    });
    await syncStayRescheduleApprovalInTx(
      transaction,
      organizationId,
      propertyId,
      clean.reschedule === 'auto',
    );
    return { policy: clean, delegateName: viewer?.name ?? null };
  });
}

/** Keep stay profile toggles aligned with the org/property reschedule approval step. */
async function syncStayRescheduleApprovalInTx(
  transaction: Tx,
  organizationId: string,
  propertyId: string | null,
  autoApproveReschedule: boolean,
) {
  const now = new Date();
  if (propertyId) {
    const unitRows = await transaction
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.propertyId, propertyId)));
    const unitIds = unitRows.map((row) => row.id);
    if (!unitIds.length) return;
    await transaction
      .update(stayProfiles)
      .set({ autoApproveReschedule, updatedAt: now })
      .where(
        and(
          eq(stayProfiles.organizationId, organizationId),
          inArray(stayProfiles.unitId, unitIds),
        ),
      );
    return;
  }
  await transaction
    .update(stayProfiles)
    .set({ autoApproveReschedule, updatedAt: now })
    .where(eq(stayProfiles.organizationId, organizationId));
}

/**
 * Claims to act as the delegate inside their organization, rebuilt from their current
 * memberships so a member who left or lost signing rights no longer approves anything.
 */
export async function delegateClaims(
  transaction: Tx,
  organizationId: string,
  delegate: ApprovalDelegate,
): Promise<SessionClaims | null> {
  const rows = await withElevatedRead(transaction, () =>
    transaction
      .select({
        roleKey: memberships.roleKey,
        partyId: memberships.partyId,
        permissions: memberships.permissions,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, delegate.userId),
          eq(memberships.status, 'active'),
        ),
      ),
  );
  if (!rows.length) return null;
  const savedRoles = await withElevatedRead(transaction, () =>
    loadSavedRolePermissions(transaction, organizationId, customRoleIds(rows)),
  );
  const access = accessFromMemberships(rows, savedRoles);
  const claims: SessionClaims = {
    sub: delegate.userId,
    sid: randomUUID(),
    organizationId,
    partyId: access.partyId,
    roles: access.roles,
    permissions: access.permissions,
    locale: 'ar',
    sessionVersion: 0,
  };
  return CONTRACT_DELEGATE_PERMISSIONS.every((permission) => hasPermission(claims, permission))
    ? claims
    : null;
}
