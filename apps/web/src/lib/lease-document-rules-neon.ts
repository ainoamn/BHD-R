import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { properties, stayPolicies } from '@bhd-r/db';
import {
  DEFAULT_LEASE_DOCUMENT_RULES,
  sanitizeLeaseDocumentRules,
  type LeaseDocumentRules,
} from '@/lib/lease-document-rules';
import {
  applyMemberScope,
  getDatabase,
  withElevatedRead,
  type MemberScope,
  type Tx,
} from '@/lib/public-booking-neon';

const POLICY_KIND = 'other';
const ORGANIZATION_SCOPE = 'org';

function policyCode(propertyId: string | null) {
  return `lease_document_rules:${propertyId ?? ORGANIZATION_SCOPE}`;
}

export type DocumentRulesSource = 'property' | 'organization' | 'default';

export type StoredDocumentRules = {
  rules: LeaseDocumentRules;
  updatedAt: string;
};

export type OwnerDocumentRulesView = {
  own: StoredDocumentRules | null;
  inherited: { source: DocumentRulesSource; rules: LeaseDocumentRules };
};

async function readDocumentRules(
  transaction: Tx,
  organizationId: string,
  propertyId: string | null,
): Promise<StoredDocumentRules | null> {
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
  const payload = (row.rulesJson ?? {}) as { rules?: unknown };
  return {
    rules: sanitizeLeaseDocumentRules(payload.rules),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Property override → organization → platform defaults. */
export async function resolveLeaseDocumentRules(
  transaction: Tx,
  organizationId: string,
  propertyId: string,
): Promise<{ source: DocumentRulesSource; rules: LeaseDocumentRules }> {
  return withElevatedRead(transaction, async () => {
    const own = await readDocumentRules(transaction, organizationId, propertyId);
    if (own) return { source: 'property' as const, rules: own.rules };
    const shared = await readDocumentRules(transaction, organizationId, null);
    if (shared) return { source: 'organization' as const, rules: shared.rules };
    return { source: 'default' as const, rules: DEFAULT_LEASE_DOCUMENT_RULES };
  });
}

export async function loadOwnerLeaseDocumentRules(
  scope: MemberScope,
  propertyId: string | null,
): Promise<OwnerDocumentRulesView> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyMemberScope(transaction, scope);
    const own = await readDocumentRules(transaction, scope.organizationId, propertyId);
    if (!propertyId) {
      return { own, inherited: { source: 'default', rules: DEFAULT_LEASE_DOCUMENT_RULES } };
    }
    const shared = await readDocumentRules(transaction, scope.organizationId, null);
    return {
      own,
      inherited: shared
        ? { source: 'organization', rules: shared.rules }
        : { source: 'default', rules: DEFAULT_LEASE_DOCUMENT_RULES },
    };
  });
}

/**
 * Saves document matrix for a property or the whole organization.
 * `rules` null removes the override (property → org, org → platform default).
 */
export async function saveLeaseDocumentRules(
  claims: SessionClaims,
  propertyId: string | null,
  rules: LeaseDocumentRules | null,
): Promise<{ rules: LeaseDocumentRules | null }> {
  const organizationId = claims.organizationId;
  if (!organizationId) throw new Error('organization_required');
  if (!hasPermission(claims, 'reservation.manage')) throw new Error('forbidden');
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
    if (!rules) return { rules: null };

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
    const clean = sanitizeLeaseDocumentRules(rules);
    await transaction.insert(stayPolicies).values({
      organizationId,
      kind: POLICY_KIND,
      code,
      nameAr: propertyId
        ? 'مستندات الإيجار المطلوبة — عقار'
        : 'مستندات الإيجار المطلوبة — المؤسسة',
      nameEn: propertyId
        ? 'Lease document requirements — property'
        : 'Lease document requirements — organization',
      version: (latest?.version ?? 0) + 1,
      rulesJson: {
        scope: 'lease_document_rules',
        propertyId,
        rules: clean,
        updatedByUserId: claims.sub,
      },
      status: 'active',
    });
    return { rules: clean };
  });
}
