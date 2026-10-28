import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  hasPermission,
  permissionsForRoles,
  type SessionClaims,
} from '@bhd-r/authz';
import { contracts, leases, stayPolicies } from '@bhd-r/db';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import {
  DEFAULT_LEASE_RENEWAL_AUTOMATION,
  isWithinRenewalLeadWindow,
  plusDays,
  resolveRenewalAutomation,
  sanitizeLeaseRenewalAutomation,
  sanitizeLeaseRenewalOverride,
  type LeaseRenewalAutomationOverride,
  type LeaseRenewalAutomationPolicy,
} from '@/lib/lease-renewal-automation';
import {
  createLeaseRenewalOnNeon,
  type CreateLeaseRenewalInput,
} from '@/lib/lease-renewal-neon';
import {
  computeLeaseTerms,
  contractPeriod,
  endDateForMonths,
  minorDigitsFor,
  type LeaseTermsDraft,
} from '@/lib/lease-terms';
import { buildRenewalTermsDraft } from '@/lib/lease-terms-draft-from';
import {
  applyMemberScope,
  getDatabase,
  type MemberScope,
} from '@/lib/public-booking-neon';
import { muscatToday } from '@/lib/tenant-charges-neon';

const POLICY_KIND = 'other';
const POLICY_CODE = 'lease_renewal_automation:org';

function fail(code: string): never {
  throw new Error(code);
}

async function readOrgPolicy(
  organizationId: string,
): Promise<LeaseRenewalAutomationPolicy> {
  return elevatedTx(async (tx) => {
    const row = await tx.query.stayPolicies.findFirst({
      where: and(
        eq(stayPolicies.organizationId, organizationId),
        eq(stayPolicies.kind, POLICY_KIND),
        eq(stayPolicies.code, POLICY_CODE),
        eq(stayPolicies.status, 'active'),
      ),
      orderBy: [desc(stayPolicies.version)],
      columns: { rulesJson: true },
    });
    const payload = (row?.rulesJson ?? {}) as { policy?: unknown };
    return sanitizeLeaseRenewalAutomation(payload.policy);
  });
}

export async function loadOwnerLeaseRenewalAutomation(
  scope: MemberScope,
): Promise<{ policy: LeaseRenewalAutomationPolicy; updatedAt: string | null }> {
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    await applyMemberScope(tx, scope);
    const row = await tx.query.stayPolicies.findFirst({
      where: and(
        eq(stayPolicies.organizationId, scope.organizationId),
        eq(stayPolicies.kind, POLICY_KIND),
        eq(stayPolicies.code, POLICY_CODE),
        eq(stayPolicies.status, 'active'),
      ),
      orderBy: [desc(stayPolicies.version)],
      columns: { rulesJson: true, updatedAt: true },
    });
    const payload = (row?.rulesJson ?? {}) as { policy?: unknown };
    return {
      policy: sanitizeLeaseRenewalAutomation(payload.policy),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });
}

export async function saveOwnerLeaseRenewalAutomation(
  claims: SessionClaims,
  policy: LeaseRenewalAutomationPolicy | null,
): Promise<{ policy: LeaseRenewalAutomationPolicy }> {
  const organizationId = claims.organizationId ?? fail('organization_required');
  if (!hasPermission(claims, 'lease.update') && !hasPermission(claims, 'reservation.manage')) {
    fail('forbidden');
  }
  const clean = sanitizeLeaseRenewalAutomation(policy ?? DEFAULT_LEASE_RENEWAL_AUTOMATION);
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    await applyMemberScope(tx, {
      organizationId,
      userId: claims.sub,
      partyId: claims.partyId,
      roles: claims.roles,
    });
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${POLICY_CODE}`}))`,
    );
    await tx
      .update(stayPolicies)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, POLICY_CODE),
          eq(stayPolicies.status, 'active'),
        ),
      );
    const [latest] = await tx
      .select({ version: sql<number>`coalesce(max(${stayPolicies.version}), 0)::int` })
      .from(stayPolicies)
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, POLICY_CODE),
        ),
      );
    await tx.insert(stayPolicies).values({
      organizationId,
      kind: POLICY_KIND,
      code: POLICY_CODE,
      nameAr: 'تجديد العقود الإلكتروني',
      nameEn: 'Electronic lease renewal',
      version: (latest?.version ?? 0) + 1,
      rulesJson: {
        scope: 'lease_renewal_automation',
        policy: clean,
        updatedByUserId: claims.sub,
      },
      status: 'active',
    });
    return { policy: clean };
  });
}

export async function saveContractRenewalAutomationOverride(
  claims: SessionClaims,
  contractId: string,
  override: LeaseRenewalAutomationOverride | null,
): Promise<{ override: LeaseRenewalAutomationOverride }> {
  const orgId = claims.organizationId ?? fail('organization_required');
  if (!hasPermission(claims, 'lease.update')) fail('forbidden');
  const clean = sanitizeLeaseRenewalOverride(override ?? {});
  return elevatedTx(async (tx) => {
    const [contract] = await tx
      .select({
        id: contracts.id,
        payload: contracts.payloadSnapshot,
        status: contracts.status,
      })
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, orgId)))
      .limit(1);
    if (!contract) fail('contract_not_found');
    if (contract.status !== 'signed') fail('renewal_not_deliverable');
    const snapshot = (contract.payload ?? {}) as Record<string, unknown>;
    const next = { ...snapshot, renewalAutomation: clean };
    await tx
      .update(contracts)
      .set({ payloadSnapshot: next, updatedAt: new Date() })
      .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, orgId)));
    return { override: clean };
  }, 15_000);
}

async function orgActorClaims(organizationId: string): Promise<SessionClaims | null> {
  // Prefer organization_owner — needs contract.sign so the addendum is delivered, not left draft.
  const rows = await elevatedTx(async (tx) =>
    rowsOf<{
      user_id: string;
      party_id: string | null;
      role_key: string;
    }>(
      await tx.execute(sql`
        select m.user_id, m.party_id, m.role_key
        from memberships m
        where m.organization_id = ${organizationId}::uuid
          and m.status = 'active'
          and m.role_key in ('organization_owner', 'organization_admin', 'property_manager')
        order by case m.role_key
          when 'organization_owner' then 0
          when 'organization_admin' then 1
          else 2 end
        limit 8`),
    ),
  );
  for (const row of rows) {
    const roleKey =
      row.role_key === 'organization_admin'
        ? ('organization_admin' as const)
        : row.role_key === 'property_manager'
          ? ('property_manager' as const)
          : ('organization_owner' as const);
    const roles = [roleKey] as const;
    const permissions = permissionsForRoles(roles);
    if (!permissions.includes('contract.sign') || !permissions.includes('contract.create')) {
      continue;
    }
    return {
      sub: row.user_id,
      sid: randomUUID(),
      organizationId,
      partyId: row.party_id,
      roles: [...roles],
      permissions,
      locale: 'ar',
      sessionVersion: 0,
    };
  }
  return null;
}

function moneyOf(snapshot: Record<string, unknown>, leaseRent: string, currency: string) {
  const rent = snapshot.rent as { amountMinor?: string; currency?: string } | undefined;
  const amount = snapshot.amount as { amountMinor?: string; currency?: string } | undefined;
  return {
    amountMinor: rent?.amountMinor ?? amount?.amountMinor ?? leaseRent,
    currency: rent?.currency ?? amount?.currency ?? currency,
  };
}

async function buildRenewalInputForLease(
  claims: SessionClaims,
  lease: {
    id: string;
    endsOn: string;
    startsOn: string;
    rentMinor: string;
    currency: string;
    billingDay: number;
    contractId: string;
  },
  policy: LeaseRenewalAutomationPolicy,
): Promise<CreateLeaseRenewalInput> {
  const parent = await elevatedTx(async (tx) =>
    tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, lease.contractId),
        eq(contracts.organizationId, claims.organizationId!),
      ),
    }),
  );
  if (!parent) fail('contract_not_found');
  const snapshot = (parent.payloadSnapshot ?? {}) as Record<string, unknown>;
  const startsOn = plusDays(lease.endsOn, 1);
  const previousMonths = Math.max(1, contractPeriod(lease.startsOn, lease.endsOn).months || 12);
  const months = policy.termMonths ?? previousMonths;
  const endsOn = endDateForMonths(startsOn, months);
  const money = moneyOf(snapshot, lease.rentMinor.toString(), lease.currency);

  const adjustments = Array.isArray(snapshot.adjustments)
    ? (snapshot.adjustments as Array<{
        kind?: string;
        title?: string;
        amount?: { amountMinor?: string };
      }>)
    : [];
  const { draft } = buildRenewalTermsDraft({
    currency: lease.currency,
    renewalStartsOn: startsOn,
    months,
    rentMinor: money.amountMinor,
    depositMinor: null,
    billingDay: lease.billingDay,
    leaseTermsRaw: snapshot.leaseTerms ?? null,
    fallbackAdjustments: adjustments
      .filter((row) => row.kind === 'add' || row.kind === 'discount')
      .map((row) => ({
        kind: row.kind as 'add' | 'discount',
        title: row.title || '—',
        amountMinor: row.amount?.amountMinor || '0',
      })),
    fallbackPaymentMethod:
      snapshot.paymentMethod === 'cheque' ||
      snapshot.paymentMethod === 'cash' ||
      snapshot.paymentMethod === 'bank_transfer'
        ? snapshot.paymentMethod
        : null,
    fallbackPaymentFrequency:
      typeof snapshot.paymentFrequency === 'string'
        ? (snapshot.paymentFrequency as LeaseTermsDraft['paymentFrequency'])
        : null,
    fallbackChequeBankName:
      typeof snapshot.chequeBankName === 'string' ? snapshot.chequeBankName : null,
    fallbackChequeAccountName:
      typeof snapshot.chequeAccountName === 'string' ? snapshot.chequeAccountName : null,
    fallbackRentBankAccountId:
      typeof snapshot.rentBankAccountId === 'string' ? snapshot.rentBankAccountId : null,
  });

  const termsDraft: LeaseTermsDraft = {
    ...draft,
    startsOn,
    endsOn,
    handoverOn: startsOn,
  };
  const digits = minorDigitsFor(lease.currency);
  const computed = computeLeaseTerms(termsDraft, lease.currency, digits, {
    deferUntilHandover: ['meters'],
  });
  if (!computed.ok) fail('invalid_terms');

  const terms = computed.terms;
  const bank =
    (typeof snapshot.chequeBankName === 'string' && snapshot.chequeBankName) ||
    terms.chequeBankName ||
    'Bank';
  const leaseShort = lease.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const cheques =
    terms.paymentMethod === 'cheque'
      ? terms.schedule.map((row, index) => ({
          bankName: (row.bankName || bank).trim() || bank,
          chequeNumber:
            (row.chequeNumber || '').trim() ||
            `ARN-${leaseShort}-${String(index + 1).padStart(2, '0')}`,
          amount: {
            amountMinor: String(row.totalMinor),
            currency: lease.currency,
          },
          dueOn: row.dueOn,
        }))
      : [];

  const leanLeaseTerms = {
    ...terms,
    meters: {
      electricityReading: terms.meters.electricityReading,
      waterReading: terms.meters.waterReading,
    },
  };

  return {
    templateVersionId: parent.templateVersionId,
    endsOn,
    rent: money,
    graceDays: terms.graceDays,
    graceAsDiscount: terms.graceAsDiscount,
    graceAmount: {
      amountMinor: String(terms.graceAmountMinor),
      currency: lease.currency,
    },
    adjustments: terms.adjustments.map((row) => ({
      kind: row.kind,
      title: row.title,
      amount: { amountMinor: String(row.lineTotalMinor), currency: lease.currency },
    })),
    paymentMethod: terms.paymentMethod,
    paymentFrequency: terms.paymentFrequency,
    months,
    cheques,
    leaseTerms: leanLeaseTerms as unknown as Record<string, unknown>,
    chequeAccountName: terms.chequeAccountName,
    chequeBankName: terms.chequeBankName,
    rentBankAccountId: terms.rentBankAccountId,
  };
}

export type AutoRenewalRun = {
  scanned: number;
  created: number;
  skipped: number;
  errors: number;
  stoppedEarly: boolean;
};

/**
 * Daily job: for each active lease whose org/contract enables automation and is
 * inside the lead window, create and deliver a renewal addendum to the tenant.
 */
export async function runLeaseAutoRenewals(deadlineMs: number): Promise<AutoRenewalRun> {
  const today = muscatToday();
  const result: AutoRenewalRun = {
    scanned: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    stoppedEarly: false,
  };

  const candidates = await elevatedTx(async (tx) =>
    rowsOf<{
      id: string;
      organization_id: string;
      contract_id: string;
      starts_on: string;
      ends_on: string;
      rent_minor: string;
      currency: string;
      billing_day: number;
      payload: unknown;
    }>(
      await tx.execute(sql`
        select l.id, l.organization_id, l.contract_id, l.starts_on::text as starts_on,
          l.ends_on::text as ends_on, l.rent_minor::text as rent_minor, l.currency,
          l.billing_day, c.payload_snapshot as payload
        from leases l
        join contracts c on c.id = l.contract_id
        where l.status = 'active'
          and l.contract_id is not null
          and c.status = 'signed'
          and not exists (
            select 1 from contracts r
            where r.parent_contract_id = c.id
              and r.kind = 'renewal'
              and r.status in ('draft', 'sent', 'partially_signed')
          )
        order by l.ends_on asc
        limit 400`),
    ),
  );

  const orgPolicyCache = new Map<string, LeaseRenewalAutomationPolicy>();

  for (const row of candidates) {
    if (Date.now() > deadlineMs) {
      result.stoppedEarly = true;
      break;
    }
    result.scanned += 1;
    try {
      let orgPolicy = orgPolicyCache.get(row.organization_id);
      if (!orgPolicy) {
        orgPolicy = await readOrgPolicy(row.organization_id);
        orgPolicyCache.set(row.organization_id, orgPolicy);
      }
      const snapshot = (row.payload ?? {}) as Record<string, unknown>;
      const override = sanitizeLeaseRenewalOverride(snapshot.renewalAutomation);
      const policy = resolveRenewalAutomation(orgPolicy, override);
      if (!policy.enabled) {
        result.skipped += 1;
        continue;
      }
      if (!isWithinRenewalLeadWindow(row.ends_on, today, policy.leadDays)) {
        result.skipped += 1;
        continue;
      }
      const claims = await orgActorClaims(row.organization_id);
      if (!claims) {
        result.skipped += 1;
        continue;
      }
      const input = await buildRenewalInputForLease(
        claims,
        {
          id: row.id,
          endsOn: row.ends_on,
          startsOn: row.starts_on,
          rentMinor: row.rent_minor,
          currency: row.currency,
          billingDay: row.billing_day,
          contractId: row.contract_id,
        },
        policy,
      );
      const created = await createLeaseRenewalOnNeon(claims, row.id, input);
      // Mark source as automated on the new contract payload.
      await elevatedTx(async (tx) => {
        const [fresh] = await tx
          .select({ payload: contracts.payloadSnapshot })
          .from(contracts)
          .where(eq(contracts.id, created.contractId))
          .limit(1);
        if (!fresh) return;
        const payload = (fresh.payload ?? {}) as Record<string, unknown>;
        await tx
          .update(contracts)
          .set({
            payloadSnapshot: {
              ...payload,
              automation: {
                source: 'cron',
                offeredAt: new Date().toISOString(),
                leadDays: policy.leadDays,
                termMonths: policy.termMonths,
                policyMinTermMonths: policy.minTermMonths,
                autoApproveShorterTerm: policy.autoApproveShorterTerm,
              },
            },
            updatedAt: new Date(),
          })
          .where(eq(contracts.id, created.contractId));
      });
      result.created += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        'lease auto-renewal failed',
        row.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return result;
}

export type TenantTermProposal = {
  endsOn: string;
  proposedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  decidedAt?: string | null;
  decisionNote?: string | null;
};

/**
 * Tenant proposes a different renewal end date. Auto-approves shorter terms when
 * policy allows and the term is still ≥ minTermMonths; otherwise waits for owner.
 */
export async function proposeRenewalTermOnNeon(
  claims: SessionClaims,
  contractId: string,
  proposedEndsOn: string,
): Promise<{ status: TenantTermProposal['status']; endsOn: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedEndsOn)) fail('renewal_date_invalid');
  const orgId = claims.organizationId ?? fail('organization_required');
  const partyId = claims.partyId ?? fail('forbidden');

  return elevatedTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 53))`);
    const contract = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, orgId),
        eq(contracts.tenantPartyId, partyId),
        eq(contracts.kind, 'renewal'),
      ),
    });
    if (!contract) fail('contract_not_found');
    if (!['sent', 'partially_signed'].includes(contract.status)) fail('renewal_not_deliverable');
    if (!contract.parentContractId) fail('renewal_not_deliverable');

    const parent = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, contract.parentContractId),
        eq(contracts.organizationId, orgId),
      ),
    });
    const lease = await tx.query.leases.findFirst({
      where: and(
        eq(leases.contractId, contract.parentContractId),
        eq(leases.organizationId, orgId),
        eq(leases.status, 'active'),
      ),
    });
    if (!lease) fail('lease_not_renewable');

    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const startsOn =
      typeof snapshot.startsOn === 'string' ? snapshot.startsOn : plusDays(lease.endsOn, 1);
    if (proposedEndsOn <= startsOn) fail('renewal_date_invalid');

    const orgPolicy = sanitizeLeaseRenewalAutomation(
      ((
        await tx.query.stayPolicies.findFirst({
          where: and(
            eq(stayPolicies.organizationId, orgId),
            eq(stayPolicies.kind, POLICY_KIND),
            eq(stayPolicies.code, POLICY_CODE),
            eq(stayPolicies.status, 'active'),
          ),
          orderBy: [desc(stayPolicies.version)],
          columns: { rulesJson: true },
        })
      )?.rulesJson as { policy?: unknown } | undefined)?.policy,
    );
    const parentSnap = (parent?.payloadSnapshot ?? {}) as Record<string, unknown>;
    const policy = resolveRenewalAutomation(
      orgPolicy,
      sanitizeLeaseRenewalOverride(parentSnap.renewalAutomation),
    );

    const proposedMonths = contractPeriod(startsOn, proposedEndsOn).months;
    if (proposedMonths < policy.minTermMonths) fail('renewal_term_too_short');

    const currentEndsOn =
      typeof snapshot.endsOn === 'string' ? snapshot.endsOn : proposedEndsOn;
    const shorter = proposedEndsOn < currentEndsOn;
    const longer = proposedEndsOn > currentEndsOn;
    const nowIso = new Date().toISOString();

    let status: TenantTermProposal['status'] = 'pending';
    if (shorter && policy.autoApproveShorterTerm) status = 'auto_approved';
    else if (!shorter && !longer) status = 'auto_approved';

    const proposal: TenantTermProposal = {
      endsOn: proposedEndsOn,
      proposedAt: nowIso,
      status,
      decidedAt: status === 'auto_approved' ? nowIso : null,
      decisionNote:
        status === 'auto_approved'
          ? shorter
            ? 'auto_approved_shorter'
            : 'unchanged'
          : null,
    };

    const nextPayload: Record<string, unknown> = {
      ...snapshot,
      tenantTermProposal: proposal,
    };

    if (status === 'auto_approved') {
      nextPayload.endsOn = proposedEndsOn;
      nextPayload.months = proposedMonths;
      if (nextPayload.leaseTerms && typeof nextPayload.leaseTerms === 'object') {
        nextPayload.leaseTerms = {
          ...(nextPayload.leaseTerms as Record<string, unknown>),
          endsOn: proposedEndsOn,
          months: proposedMonths,
        };
      }
    }

    await tx
      .update(contracts)
      .set({ payloadSnapshot: nextPayload, updatedAt: new Date() })
      .where(eq(contracts.id, contract.id));

    const reference = contract.reference ?? contract.id.slice(0, 8).toUpperCase();
    if (status === 'pending') {
      await notifyByEmail({
        orgId,
        aggregateType: 'contract',
        aggregateId: contract.id,
        audience: { parties: [contract.ownerPartyId] },
        content: () => ({
          tone: 'contract',
          subject: `⏳ طلب تعديل مدة التجديد — ${reference}`,
          title: 'المستأجر يطلب مدة تجديد مختلفة',
          intro: `اقترح المستأجر نهاية جديدة للتجديد: ${proposedEndsOn}. راجع الطلب واعتمد أو ارفض.`,
          cta: {
            label: 'فتح الملحق',
            url: appLink(`/ar/owner/contracts/${contract.id}`),
          },
        }),
      });
    } else {
      await notifyByEmail({
        orgId,
        aggregateType: 'contract',
        aggregateId: contract.id,
        audience: { parties: [contract.tenantPartyId, contract.ownerPartyId] },
        content: () => ({
          tone: 'contract',
          subject: `✅ اعتُمدت مدة التجديد — ${reference}`,
          title: 'مدة التجديد محدّثة',
          intro: `نهاية الملحق أصبحت ${proposedEndsOn}. أكمل التوقيع والمستندات من حسابك.`,
          cta: {
            label: 'فتح الملحق',
            url: appLink(`/ar/tenant/contracts/${contract.id}`),
          },
        }),
      });
    }

    return { status, endsOn: proposedEndsOn };
  }, 20_000);
}

/** Owner approves or rejects a pending tenant term proposal. */
export async function decideRenewalTermProposalOnNeon(
  claims: SessionClaims,
  contractId: string,
  decision: 'approved' | 'rejected',
  note?: string | null,
): Promise<{ status: TenantTermProposal['status'] }> {
  const orgId = claims.organizationId ?? fail('organization_required');
  if (!hasPermission(claims, 'lease.update') && !hasPermission(claims, 'contract.sign')) {
    fail('forbidden');
  }

  return elevatedTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 53))`);
    const contract = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, orgId),
        eq(contracts.kind, 'renewal'),
      ),
    });
    if (!contract) fail('contract_not_found');
    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const raw = snapshot.tenantTermProposal as TenantTermProposal | undefined;
    if (!raw || raw.status !== 'pending') fail('renewal_not_deliverable');

    const nowIso = new Date().toISOString();
    const proposal: TenantTermProposal = {
      ...raw,
      status: decision,
      decidedAt: nowIso,
      decisionNote: note?.trim().slice(0, 500) || decision,
    };
    const nextPayload: Record<string, unknown> = {
      ...snapshot,
      tenantTermProposal: proposal,
    };
    if (decision === 'approved') {
      const startsOn =
        typeof snapshot.startsOn === 'string' ? snapshot.startsOn : raw.endsOn;
      const months = contractPeriod(startsOn, raw.endsOn).months;
      nextPayload.endsOn = raw.endsOn;
      nextPayload.months = months;
      if (nextPayload.leaseTerms && typeof nextPayload.leaseTerms === 'object') {
        nextPayload.leaseTerms = {
          ...(nextPayload.leaseTerms as Record<string, unknown>),
          endsOn: raw.endsOn,
          months,
        };
      }
    }

    await tx
      .update(contracts)
      .set({ payloadSnapshot: nextPayload, updatedAt: new Date() })
      .where(eq(contracts.id, contract.id));

    const reference = contract.reference ?? contract.id.slice(0, 8).toUpperCase();
    await notifyByEmail({
      orgId,
      aggregateType: 'contract',
      aggregateId: contract.id,
      audience: { parties: [contract.tenantPartyId] },
      content: () =>
        decision === 'approved'
          ? {
              tone: 'contract',
              subject: `✅ اعتُمدت مدة التجديد — ${reference}`,
              title: 'المالك اعتمد مدة التجديد',
              intro: `نهاية الملحق أصبحت ${raw.endsOn}. أكمل المستندات والتوقيع.`,
              cta: {
                label: 'فتح الملحق',
                url: appLink(`/ar/tenant/contracts/${contract.id}`),
              },
            }
          : {
              tone: 'contract',
              subject: `⛔ رُفض تعديل مدة التجديد — ${reference}`,
              title: 'المالك رفض المدة المقترحة',
              intro: note?.trim()
                ? `السبب: ${note.trim()}. المدة الأصلية ما زالت سارية للمتابعة.`
                : 'المدة الأصلية ما زالت سارية — يمكنك التوقيع عليها أو اقتراح مدة أخرى ضمن الحد الأدنى.',
              cta: {
                label: 'فتح الملحق',
                url: appLink(`/ar/tenant/contracts/${contract.id}`),
              },
            },
    });

    return { status: proposal.status };
  }, 20_000);
}
