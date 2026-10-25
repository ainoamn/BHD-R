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
  DEFAULT_APPROVAL_POLICY_BY_KIND,
  isContractApprovalKind,
  sanitizeApprovalPolicy,
  type ApprovalPolicy,
  type ApprovalPolicySource,
  type ContractApprovalKind,
  CONTRACT_APPROVAL_KINDS,
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

/** Who may save each contract kind's policy. */
const KIND_MANAGE_PERMISSIONS: Record<ContractApprovalKind, Permission[]> = {
  daily: ['stay.booking.manage', 'reservation.manage'],
  rent: ['reservation.manage'],
  sale: ['sale.manage', 'reservation.manage'],
};

function legacyPolicyCode(propertyId: string | null) {
  return `approval_policy:${propertyId ?? ORGANIZATION_SCOPE}`;
}

function policyCode(kind: ContractApprovalKind, propertyId: string | null) {
  return `approval_policy:${kind}:${propertyId ?? ORGANIZATION_SCOPE}`;
}

function kindNames(kind: ContractApprovalKind, propertyId: string | null) {
  const labels: Record<ContractApprovalKind, [string, string]> = {
    daily: ['سياسة اعتماد الإيجار اليومي', 'Daily rental approval policy'],
    rent: ['سياسة اعتماد الإيجار طويل الأجل', 'Long-term lease approval policy'],
    sale: ['سياسة اعتماد عقود الشراء', 'Purchase contract approval policy'],
  };
  const [ar, en] = labels[kind];
  return {
    nameAr: propertyId ? `${ar} — عقار` : `${ar} — المؤسسة`,
    nameEn: propertyId ? `${en} — property` : `${en} — organization`,
  };
}

/** The member who set the policy; automatic contract approval signs in their name. */
export type ApprovalDelegate = { userId: string; name: string | null };

export type StoredApprovalPolicy = {
  policy: ApprovalPolicy;
  delegate: ApprovalDelegate | null;
  updatedAt: string;
  kind: ContractApprovalKind;
};

export type ResolvedApprovalPolicy = {
  source: ApprovalPolicySource;
  policy: ApprovalPolicy;
  delegate: ApprovalDelegate | null;
  kind: ContractApprovalKind;
};

function parseDelegate(rules: { delegate?: unknown }): ApprovalDelegate | null {
  const delegate = rules.delegate as Partial<ApprovalDelegate> | undefined;
  return delegate && typeof delegate.userId === 'string'
    ? {
        userId: delegate.userId,
        name: typeof delegate.name === 'string' ? delegate.name : null,
      }
    : null;
}

async function readPolicyRow(
  transaction: Tx,
  organizationId: string,
  code: string,
  kind: ContractApprovalKind,
): Promise<StoredApprovalPolicy | null> {
  const row = await transaction.query.stayPolicies.findFirst({
    where: and(
      eq(stayPolicies.organizationId, organizationId),
      eq(stayPolicies.kind, POLICY_KIND),
      eq(stayPolicies.code, code),
      eq(stayPolicies.status, 'active'),
    ),
    orderBy: [desc(stayPolicies.version)],
    columns: { rulesJson: true, updatedAt: true },
  });
  if (!row) return null;
  const rules = (row.rulesJson ?? {}) as { policy?: unknown; delegate?: unknown };
  return {
    policy: sanitizeApprovalPolicy(rules.policy, kind),
    delegate: parseDelegate(rules),
    updatedAt: row.updatedAt.toISOString(),
    kind,
  };
}

/** Caller must already be scoped to `organizationId`. */
export async function readApprovalPolicy(
  transaction: Tx,
  organizationId: string,
  propertyId: string | null,
  kind: ContractApprovalKind = 'rent',
): Promise<StoredApprovalPolicy | null> {
  const typed = await readPolicyRow(
    transaction,
    organizationId,
    policyCode(kind, propertyId),
    kind,
  );
  if (typed) return typed;
  // Legacy unscoped policy (pre per-kind) — reuse until the owner saves a typed one.
  return readPolicyRow(transaction, organizationId, legacyPolicyCode(propertyId), kind);
}

/**
 * Property typed → property legacy → org typed → org legacy → kind default.
 */
export async function resolveApprovalPolicy(
  transaction: Tx,
  organizationId: string,
  propertyId: string,
  kind: ContractApprovalKind = 'rent',
): Promise<ResolvedApprovalPolicy> {
  return withElevatedRead(transaction, async () => {
    const propertyTyped = await readPolicyRow(
      transaction,
      organizationId,
      policyCode(kind, propertyId),
      kind,
    );
    if (propertyTyped) {
      return {
        source: 'property' as const,
        policy: propertyTyped.policy,
        delegate: propertyTyped.delegate,
        kind,
      };
    }
    const propertyLegacy = await readPolicyRow(
      transaction,
      organizationId,
      legacyPolicyCode(propertyId),
      kind,
    );
    if (propertyLegacy) {
      return {
        source: 'legacy' as const,
        policy: propertyLegacy.policy,
        delegate: propertyLegacy.delegate,
        kind,
      };
    }
    const orgTyped = await readPolicyRow(
      transaction,
      organizationId,
      policyCode(kind, null),
      kind,
    );
    if (orgTyped) {
      return {
        source: 'organization' as const,
        policy: orgTyped.policy,
        delegate: orgTyped.delegate,
        kind,
      };
    }
    const orgLegacy = await readPolicyRow(
      transaction,
      organizationId,
      legacyPolicyCode(null),
      kind,
    );
    if (orgLegacy) {
      return {
        source: 'legacy' as const,
        policy: orgLegacy.policy,
        delegate: orgLegacy.delegate,
        kind,
      };
    }
    return {
      source: 'default' as const,
      policy: DEFAULT_APPROVAL_POLICY_BY_KIND[kind],
      delegate: null,
      kind,
    };
  });
}

export type OwnerApprovalPolicyView = {
  kind: ContractApprovalKind;
  own: StoredApprovalPolicy | null;
  /** What applies without an override at this level. */
  inherited: { source: ApprovalPolicySource; policy: ApprovalPolicy };
};

export type OwnerApprovalPolicyBundle = {
  kinds: OwnerApprovalPolicyView[];
};

export async function loadOwnerApprovalPolicy(
  scope: MemberScope,
  propertyId: string | null,
  kind: ContractApprovalKind = 'rent',
): Promise<OwnerApprovalPolicyView> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyMemberScope(transaction, scope);
    const ownTyped = await readPolicyRow(
      transaction,
      scope.organizationId,
      policyCode(kind, propertyId),
      kind,
    );
    if (!propertyId) {
      const legacy = ownTyped
        ? null
        : await readPolicyRow(
            transaction,
            scope.organizationId,
            legacyPolicyCode(null),
            kind,
          );
      return {
        kind,
        own: ownTyped,
        inherited: {
          source: legacy ? 'legacy' : 'default',
          policy: legacy?.policy ?? DEFAULT_APPROVAL_POLICY_BY_KIND[kind],
        },
      };
    }
    const orgTyped = await readPolicyRow(
      transaction,
      scope.organizationId,
      policyCode(kind, null),
      kind,
    );
    const orgLegacy = orgTyped
      ? null
      : await readPolicyRow(transaction, scope.organizationId, legacyPolicyCode(null), kind);
    const propertyLegacy = ownTyped
      ? null
      : await readPolicyRow(
          transaction,
          scope.organizationId,
          legacyPolicyCode(propertyId),
          kind,
        );
    const inherited = propertyLegacy
      ? { source: 'legacy' as const, policy: propertyLegacy.policy }
      : orgTyped
        ? { source: 'organization' as const, policy: orgTyped.policy }
        : orgLegacy
          ? { source: 'legacy' as const, policy: orgLegacy.policy }
          : { source: 'default' as const, policy: DEFAULT_APPROVAL_POLICY_BY_KIND[kind] };
    return { kind, own: ownTyped, inherited };
  });
}

export async function loadOwnerApprovalPolicyBundle(
  scope: MemberScope,
  propertyId: string | null,
): Promise<OwnerApprovalPolicyBundle> {
  const kinds = await Promise.all(
    CONTRACT_APPROVAL_KINDS.map((kind) => loadOwnerApprovalPolicy(scope, propertyId, kind)),
  );
  return { kinds };
}

function canManageKind(claims: SessionClaims, kind: ContractApprovalKind): boolean {
  return KIND_MANAGE_PERMISSIONS[kind].some((permission) => hasPermission(claims, permission));
}

/**
 * Saves the policy for one contract kind at property or organization scope.
 * `policy` null removes the typed override (falls back to legacy / wider / default).
 */
export async function saveApprovalPolicy(
  claims: SessionClaims,
  propertyId: string | null,
  policy: ApprovalPolicy | null,
  kind: ContractApprovalKind = 'rent',
): Promise<{ policy: ApprovalPolicy | null; delegateName: string | null; kind: ContractApprovalKind }> {
  const organizationId = claims.organizationId;
  if (!organizationId) throw new Error('organization_required');
  if (!isContractApprovalKind(kind)) throw new Error('invalid_body');
  if (!canManageKind(claims, kind)) throw new Error('forbidden');
  if (
    policy?.contract === 'auto' &&
    !CONTRACT_DELEGATE_PERMISSIONS.every((permission) => hasPermission(claims, permission))
  ) {
    throw new Error('approval_delegate_forbidden');
  }
  const code = policyCode(kind, propertyId);
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
    if (!policy) return { policy: null, delegateName: null, kind };

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
    const clean = sanitizeApprovalPolicy(policy, kind);
    const names = kindNames(kind, propertyId);
    await transaction.insert(stayPolicies).values({
      organizationId,
      kind: POLICY_KIND,
      code,
      nameAr: names.nameAr,
      nameEn: names.nameEn,
      version: (latest?.version ?? 0) + 1,
      rulesJson: {
        scope: 'approval_policy',
        contractKind: kind,
        propertyId,
        policy: clean,
        delegate: { userId: claims.sub, name: viewer?.name ?? null },
        updatedByUserId: claims.sub,
      },
      status: 'active',
    });
    if (kind === 'daily') {
      await syncStayRescheduleApprovalInTx(
        transaction,
        organizationId,
        propertyId,
        clean.reschedule === 'auto',
      );
    }
    return { policy: clean, delegateName: viewer?.name ?? null, kind };
  });
}

/** Keep stay profile toggles aligned with the daily reschedule approval step. */
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
