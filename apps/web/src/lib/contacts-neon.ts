import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  CONTACT_ROLE_KEYS,
  type ContactAddress,
  type ContactDetail,
  type ContactMoneyLine,
  type ContactSummary,
  type ContactUpdate,
  type MoneyTotals,
} from '@/lib/contacts-shared';
import { partyBadgeChips, partyChipsOf } from '@/lib/badge-chips-neon';
import { marksForParties, NO_MARK } from '@/lib/identity-marks-neon';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

const LIST_LIMIT = 500;
const ROW_LIMIT = 100;
const PAID_STAY = sql`('confirmed', 'pre_arrival', 'checked_in', 'checked_out', 'closed')`;
const LIVE_LEASE = sql`('active', 'cancel_requested', 'clearance_pending')`;

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function day(value: Date | string | null | undefined): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function requireOrg(claims: SessionClaims): string {
  if (!claims.organizationId || !hasPermission(claims, 'party.read')) throw new Error('forbidden');
  return claims.organizationId;
}

/** A building owner only sees their own properties: `alias` is a `properties` row. */
function propertyScope(claims: SessionClaims, alias: string): SQL {
  const scope = ownerPartyScope(claims);
  return scope ? sql`and ${sql.raw(alias)}.owner_party_id = ${scope}` : sql``;
}

/** For a building owner: the party is themselves or deals with one of their properties. */
function partyScope(claims: SessionClaims, party: SQL): SQL {
  const scope = ownerPartyScope(claims);
  if (!scope) return sql``;
  return sql`and (
    ${party} = ${scope}
    or exists (select 1 from leases l join units u on u.id = l.unit_id join properties pr on pr.id = u.property_id
      where l.tenant_party_id = ${party} and pr.owner_party_id = ${scope})
    or exists (select 1 from contracts c join units u on u.id = c.unit_id join properties pr on pr.id = u.property_id
      where c.tenant_party_id = ${party} and pr.owner_party_id = ${scope})
    or exists (select 1 from reservations r join units u on u.id = r.unit_id join properties pr on pr.id = u.property_id
      where r.tenant_party_id = ${party} and pr.owner_party_id = ${scope})
    or exists (select 1 from stay_bookings b join properties pr on pr.id = b.property_id
      where b.guest_party_id = ${party} and pr.owner_party_id = ${scope})
  )`;
}

export async function listContacts(claims: SessionClaims): Promise<ContactSummary[]> {
  const orgId = requireOrg(claims);
  const list = await listContactRows(claims, orgId);
  const ids = list.map((contact) => contact.id);
  const [marks, chips] = await Promise.all([
    marksForParties(orgId, ids),
    partyBadgeChips(orgId, ids),
  ]);
  return list.map((contact) => {
    const badges = partyChipsOf(chips, contact.id);
    return {
      ...contact,
      mark: marks.get(contact.id) ?? NO_MARK,
      ...(badges.length ? { badges } : {}),
    };
  });
}

async function listContactRows(claims: SessionClaims, orgId: string): Promise<ContactSummary[]> {
  return withinViewerTenant(claims, async (tx) => {
    const result = rows<{
      id: string;
      display_name: string;
      type: 'person' | 'company';
      email: string | null;
      phone: string | null;
      status: string;
      roles: string[] | null;
      properties: number;
      active_leases: number;
      contracts: number;
      open_legal: number;
      member: boolean;
    }>(
      await tx.execute(sql`
        select
          p.id, p.display_name, p.type, p.email, p.phone, p.status,
          (select array_agg(r.role_key order by r.role_key) from party_roles r
            where r.organization_id = p.organization_id and r.party_id = p.id and r.status = 'active') as roles,
          (select count(*)::int from properties x
            where x.organization_id = p.organization_id and x.owner_party_id = p.id) as properties,
          (select count(*)::int from leases l
            where l.organization_id = p.organization_id and l.tenant_party_id = p.id
              and l.status in ${LIVE_LEASE}) as active_leases,
          (select count(*)::int from contracts c
            where c.organization_id = p.organization_id and c.status <> 'void'
              and (c.tenant_party_id = p.id or c.owner_party_id = p.id)) as contracts,
          (select count(*)::int from legal_cases lc
            where lc.organization_id = p.organization_id
              and (lc.counterparty_id = p.id or lc.lawyer_party_id = p.id)
              and lc.status not in ('settled', 'closed', 'cancelled')) as open_legal,
          exists (select 1 from memberships m
            where m.organization_id = p.organization_id and m.party_id = p.id) as member
        from parties p
        where p.organization_id = ${orgId} ${partyScope(claims, sql`p.id`)}
        order by p.status = 'archived', lower(p.display_name)
        limit ${LIST_LIMIT}
      `),
    );
    return result.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      type: row.type,
      email: row.email,
      phone: row.phone,
      status: row.status,
      roles: row.roles ?? [],
      properties: Number(row.properties),
      activeLeases: Number(row.active_leases),
      contracts: Number(row.contracts),
      openLegal: Number(row.open_legal),
      member: Boolean(row.member),
    }));
  });
}

function totals(lines: ContactMoneyLine[], keys: ContactMoneyLine['key'][]): MoneyTotals {
  const byCurrency = new Map<string, bigint>();
  for (const line of lines) {
    if (!keys.includes(line.key)) continue;
    byCurrency.set(line.currency, (byCurrency.get(line.currency) ?? 0n) + BigInt(line.minor));
  }
  return [...byCurrency.entries()]
    .filter(([, minor]) => minor !== 0n)
    .map(([currency, minor]) => ({ currency, minor: minor.toString() }));
}

async function moneyLine(
  tx: Tx,
  key: ContactMoneyLine['key'],
  query: SQL,
): Promise<ContactMoneyLine[]> {
  const result = rows<{ currency: string | null; minor: string | null; count: number }>(
    await tx.execute(query),
  );
  return result
    .filter((row) => row.minor && row.minor !== '0')
    .map((row) => ({
      key,
      currency: row.currency || 'OMR',
      minor: String(row.minor),
      count: Number(row.count),
    }));
}

async function loadMoney(
  tx: Tx,
  orgId: string,
  partyId: string,
  ownedIds: string[],
  claims: SessionClaims,
): Promise<ContactDetail['money']> {
  const scope = ownerPartyScope(claims);
  const stayScope = scope
    ? sql`and exists (select 1 from properties pr where pr.id = b.property_id and pr.owner_party_id = ${scope})`
    : sql``;
  const unitScope = (unitColumn: SQL) =>
    scope
      ? sql`and exists (select 1 from units u join properties pr on pr.id = u.property_id
          where u.id = ${unitColumn} and pr.owner_party_id = ${scope})`
      : sql``;
  const depositMinor = sql`(r.terms_snapshot->>'depositMinor')::bigint`;
  const queries: [ContactMoneyLine['key'], SQL][] = [
    [
      'stay_payments',
      sql`select b.currency, sum(b.total_minor)::text as minor, count(*)::int as count
        from stay_bookings b
        where b.organization_id = ${orgId} and b.guest_party_id = ${partyId}
          and b.status in ${PAID_STAY} ${stayScope}
        group by b.currency`,
    ],
    [
      'reservation_deposits',
      sql`select coalesce(r.currency, 'OMR') as currency, sum(${depositMinor})::text as minor, count(*)::int as count
        from reservations r
        where r.organization_id = ${orgId} and r.tenant_party_id = ${partyId}
          and r.terms_snapshot->>'depositPaidAt' is not null
          and r.terms_snapshot->>'depositMinor' ~ '^[0-9]+$' ${unitScope(sql`r.unit_id`)}
        group by 1`,
    ],
    [
      'invoice_payments',
      sql`select i.currency, sum(i.paid_minor)::text as minor, count(*)::int as count
        from invoices i
        where i.organization_id = ${orgId} and i.tenant_party_id = ${partyId}
          and i.status <> 'void' and i.paid_minor > 0
          ${scope ? sql`and exists (select 1 from leases l join units u on u.id = l.unit_id join properties pr on pr.id = u.property_id where l.id = i.lease_id and pr.owner_party_id = ${scope})` : sql``}
        group by i.currency`,
    ],
    [
      'invoices_due',
      sql`select i.currency, sum(i.total_minor - i.paid_minor)::text as minor, count(*)::int as count
        from invoices i
        where i.organization_id = ${orgId} and i.tenant_party_id = ${partyId}
          and i.status in ('issued', 'partially_paid', 'overdue')
          ${scope ? sql`and exists (select 1 from leases l join units u on u.id = l.unit_id join properties pr on pr.id = u.property_id where l.id = i.lease_id and pr.owner_party_id = ${scope})` : sql``}
        group by i.currency`,
    ],
    [
      'deposit_refunds',
      sql`select f.currency,
          sum(coalesce(f.paid_minor, case when f.status = 'executed' then f.amount_minor end))::text as minor,
          count(*)::int as count
        from stay_refunds f join stay_bookings b on b.id = f.booking_id
        where f.organization_id = ${orgId} and b.guest_party_id = ${partyId}
          and (f.paid_minor > 0 or f.status = 'executed') ${stayScope}
        group by f.currency`,
    ],
  ];
  if (!scope) {
    queries.push([
      'vendor_expenses',
      sql`select e.currency, sum(e.amount_minor + e.tax_minor)::text as minor, count(*)::int as count
        from expenses e join vendors v on v.id = e.vendor_id
        where e.organization_id = ${orgId} and v.party_id = ${partyId} and e.paid_at is not null
        group by e.currency`,
    ]);
  }
  if (ownedIds.length) {
    const owned = sql`(${sql.join(
      ownedIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`;
    queries.push(
      [
        'property_stays',
        sql`select b.currency, sum(b.total_minor)::text as minor, count(*)::int as count
          from stay_bookings b
          where b.organization_id = ${orgId} and b.property_id in ${owned} and b.status in ${PAID_STAY}
          group by b.currency`,
      ],
      [
        'property_deposits',
        sql`select coalesce(r.currency, 'OMR') as currency, sum(${depositMinor})::text as minor, count(*)::int as count
          from reservations r join units u on u.id = r.unit_id
          where r.organization_id = ${orgId} and u.property_id in ${owned}
            and r.terms_snapshot->>'depositPaidAt' is not null
            and r.terms_snapshot->>'depositMinor' ~ '^[0-9]+$'
          group by 1`,
      ],
      [
        'property_invoices',
        sql`select i.currency, sum(i.paid_minor)::text as minor, count(*)::int as count
          from invoices i join leases l on l.id = i.lease_id join units u on u.id = l.unit_id
          where i.organization_id = ${orgId} and u.property_id in ${owned}
            and i.status <> 'void' and i.paid_minor > 0
          group by i.currency`,
      ],
      [
        'property_expenses',
        sql`select e.currency, sum(e.amount_minor + e.tax_minor)::text as minor, count(*)::int as count
          from expenses e
          where e.organization_id = ${orgId} and e.property_id in ${owned}
            and (e.paid_at is not null or e.status in ('approved', 'completed'))
          group by e.currency`,
      ],
    );
  }
  const lines: ContactMoneyLine[] = [];
  for (const [key, query] of queries) lines.push(...(await moneyLine(tx, key, query)));
  return {
    received: totals(lines, ['stay_payments', 'reservation_deposits', 'invoice_payments']),
    paid: totals(lines, ['deposit_refunds', 'vendor_expenses']),
    outstanding: totals(lines, ['invoices_due']),
    propertyIncome: totals(lines, ['property_stays', 'property_deposits', 'property_invoices']),
    propertyExpenses: totals(lines, ['property_expenses']),
    lines,
  };
}

type PlaceRow = {
  property_id: string | null;
  property_name_ar: string | null;
  property_name_en: string | null;
  unit_code: string | null;
};

function place(row: PlaceRow) {
  return {
    propertyId: row.property_id,
    propertyNameAr: row.property_name_ar,
    propertyNameEn: row.property_name_en,
    unitCode: row.unit_code,
  };
}

export async function readContact(
  claims: SessionClaims,
  partyId: string,
): Promise<ContactDetail | null> {
  const orgId = requireOrg(claims);
  const detail = await readContactRows(claims, orgId, partyId);
  if (!detail) return null;
  const [marks, chips] = await Promise.all([
    marksForParties(orgId, [detail.party.id]),
    partyBadgeChips(orgId, [detail.party.id]),
  ]);
  return {
    ...detail,
    party: {
      ...detail.party,
      mark: marks.get(detail.party.id) ?? NO_MARK,
      badges: partyChipsOf(chips, detail.party.id),
    },
  };
}

async function readContactRows(
  claims: SessionClaims,
  orgId: string,
  partyId: string,
): Promise<ContactDetail | null> {
  return withinViewerTenant(claims, async (tx) => {
    const { repairChildContractReferencesInTx } = await import('@/lib/contract-reference-neon');
    await repairChildContractReferencesInTx(tx, orgId).catch((error: unknown) => {
      console.error('repair child contract references failed', error);
    });
    const [party] = rows<{
      id: string;
      display_name: string;
      type: 'person' | 'company';
      email: string | null;
      phone: string | null;
      status: string;
      notes: string | null;
      name_en: string | null;
      source: string | null;
      created_at: Date | string;
      member: boolean;
    }>(
      await tx.execute(sql`
        select p.id, p.display_name, p.type, p.email, p.phone, p.status,
          p.metadata->>'notes' as notes, p.metadata->>'nameEn' as name_en,
          p.metadata->>'source' as source, p.created_at,
          exists (select 1 from memberships m
            where m.organization_id = p.organization_id and m.party_id = p.id) as member
        from parties p
        where p.organization_id = ${orgId} and p.id = ${partyId} ${partyScope(claims, sql`p.id`)}
      `),
    );
    if (!party) return null;

    const roleRows = rows<{ role_key: string }>(
      await tx.execute(sql`
        select role_key from party_roles
        where organization_id = ${orgId} and party_id = ${partyId} and status = 'active'
        order by role_key
      `),
    );
    const [address] = rows<{
      governorate: string;
      wilayat: string;
      city: string;
      area: string | null;
      street: string | null;
      building_number: string | null;
      postal_code: string | null;
    }>(
      await tx.execute(sql`
        select a.governorate, a.wilayat, a.city, a.area, a.street, a.building_number, a.postal_code
        from party_addresses pa join addresses a on a.id = pa.address_id
        where pa.organization_id = ${orgId} and pa.party_id = ${partyId}
        order by pa.primary desc, pa.created_at
        limit 1
      `),
    );

    const owned = rows<{
      id: string;
      name_ar: string;
      name_en: string | null;
      category: string;
      units: number;
      leased: number;
      share: number | null;
    }>(
      await tx.execute(sql`
        select pr.id, pr.name_ar, pr.name_en, pr.category::text as category,
          (select count(*)::int from units u where u.property_id = pr.id) as units,
          (select count(distinct l.unit_id)::int from leases l join units u on u.id = l.unit_id
            where u.property_id = pr.id and l.status in ${LIVE_LEASE}) as leased,
          (select i.share_basis_points from property_ownership_interests i
            where i.property_id = pr.id and i.party_id = ${partyId} limit 1) as share
        from properties pr
        where pr.organization_id = ${orgId}
          and (pr.owner_party_id = ${partyId} or exists (
            select 1 from property_ownership_interests i
            where i.property_id = pr.id and i.party_id = ${partyId}))
          ${propertyScope(claims, 'pr')}
        order by pr.name_ar
        limit ${ROW_LIMIT}
      `),
    );

    const leases = rows<
      PlaceRow & {
        id: string;
        status: string;
        starts_on: Date | string;
        ends_on: Date | string;
        rent_minor: string;
        currency: string;
        contract_id: string | null;
      }
    >(
      await tx.execute(sql`
        select l.id, l.status, l.starts_on, l.ends_on, l.rent_minor::text as rent_minor, l.currency,
          l.contract_id, pr.id as property_id, pr.name_ar as property_name_ar,
          pr.name_en as property_name_en, u.code as unit_code
        from leases l join units u on u.id = l.unit_id join properties pr on pr.id = u.property_id
        where l.organization_id = ${orgId} and l.tenant_party_id = ${partyId}
          ${propertyScope(claims, 'pr')}
        order by l.status in ${LIVE_LEASE} desc, l.starts_on desc
        limit ${ROW_LIMIT}
      `),
    );

    const contracts = rows<
      PlaceRow & {
        id: string;
        reference: string | null;
        status: string;
        side: 'owner' | 'tenant';
        contract_type: string | null;
        created_at: Date | string;
      }
    >(
      await tx.execute(sql`
        select c.id, c.reference, c.status,
          case when c.tenant_party_id = ${partyId} then 'tenant' else 'owner' end as side,
          c.payload_snapshot->'contract'->>'type' as contract_type, c.created_at,
          pr.id as property_id, pr.name_ar as property_name_ar, pr.name_en as property_name_en,
          u.code as unit_code
        from contracts c join units u on u.id = c.unit_id join properties pr on pr.id = u.property_id
        where c.organization_id = ${orgId} and c.status <> 'void'
          and (c.tenant_party_id = ${partyId} or c.owner_party_id = ${partyId})
          ${propertyScope(claims, 'pr')}
        order by c.created_at desc
        limit ${ROW_LIMIT}
      `),
    );

    const reservations = rows<
      PlaceRow & {
        id: string;
        reference: string | null;
        mode: string | null;
        status: string;
        deposit_minor: string | null;
        currency: string | null;
        paid_at: string | null;
      }
    >(
      await tx.execute(sql`
        select r.id, r.terms_snapshot->>'referenceCode' as reference, r.terms_snapshot->>'mode' as mode,
          r.status, r.terms_snapshot->>'depositMinor' as deposit_minor, r.currency,
          r.terms_snapshot->>'depositPaidAt' as paid_at,
          pr.id as property_id, pr.name_ar as property_name_ar, pr.name_en as property_name_en,
          u.code as unit_code
        from reservations r join units u on u.id = r.unit_id join properties pr on pr.id = u.property_id
        where r.organization_id = ${orgId} and r.tenant_party_id = ${partyId}
          ${propertyScope(claims, 'pr')}
        order by r.created_at desc
        limit ${ROW_LIMIT}
      `),
    );

    const stays = rows<
      PlaceRow & {
        id: string;
        reference: string;
        status: string;
        check_in_on: Date | string;
        check_out_on: Date | string;
        total_minor: string;
        currency: string;
      }
    >(
      await tx.execute(sql`
        select b.id, b.reference_code as reference, b.status, b.check_in_on, b.check_out_on,
          b.total_minor::text as total_minor, b.currency,
          pr.id as property_id, pr.name_ar as property_name_ar, pr.name_en as property_name_en,
          u.code as unit_code
        from stay_bookings b join properties pr on pr.id = b.property_id
          left join units u on u.id = b.unit_id
        where b.organization_id = ${orgId} and b.guest_party_id = ${partyId}
          ${propertyScope(claims, 'pr')}
        order by b.check_in_on desc
        limit ${ROW_LIMIT}
      `),
    );

    const ownedIds = owned.map((row) => row.id);
    const maintenance = rows<
      PlaceRow & {
        id: string;
        title: string;
        status: string;
        priority: string;
        created_at: Date | string;
      }
    >(
      await tx.execute(sql`
        select t.id, t.title, t.status, t.priority, t.created_at,
          pr.id as property_id, pr.name_ar as property_name_ar, pr.name_en as property_name_en,
          u.code as unit_code
        from maintenance_tickets t join units u on u.id = t.unit_id
          join properties pr on pr.id = u.property_id
        where t.organization_id = ${orgId}
          and (
            t.opened_by_party_id = ${partyId}
            or pr.owner_party_id = ${partyId}
            or exists (select 1 from leases l where l.unit_id = t.unit_id
              and l.tenant_party_id = ${partyId} and l.status in ${LIVE_LEASE})
          )
          ${propertyScope(claims, 'pr')}
        order by t.created_at desc
        limit ${ROW_LIMIT}
      `),
    );

    const legal = rows<{
      id: string;
      reference: string;
      title: string;
      status: string;
      side: 'counterparty' | 'lawyer';
      claim_minor: string;
      recovered_minor: string;
      currency: string;
      next_hearing_at: Date | string | null;
    }>(
      await tx.execute(sql`
        select lc.id, lc.reference, lc.title, lc.status,
          case when lc.lawyer_party_id = ${partyId} then 'lawyer' else 'counterparty' end as side,
          lc.claim_amount_minor::text as claim_minor, lc.recovered_amount_minor::text as recovered_minor,
          lc.currency, lc.next_hearing_at
        from legal_cases lc left join properties pr on pr.id = lc.property_id
        where lc.organization_id = ${orgId}
          and (lc.counterparty_id = ${partyId} or lc.lawyer_party_id = ${partyId})
          ${ownerPartyScope(claims) ? sql`and pr.owner_party_id = ${ownerPartyScope(claims)}` : sql``}
        order by lc.opened_on desc
        limit ${ROW_LIMIT}
      `),
    );

    const taskRows = rows<{ id: string; reference: string; title: string; status: string }>(
      await tx.execute(sql`
        select t.id::text as id, t.reference, t.title, t.status::text as status
        from work_tasks t
        join lateral (
          select metadata from workflow_events e
          where e.organization_id = t.organization_id
            and e.resource_type = 'work_task'
            and e.resource_id = t.id
            and e.event_type = 'task.link'
          order by e.occurred_at desc
          limit 1
        ) link on true
        where t.organization_id = ${orgId}
          and link.metadata->>'partyId' = ${partyId}
        order by t.created_at desc
        limit 40
      `),
    );

    const money = await loadMoney(tx, orgId, partyId, ownedIds, claims);

    return {
      party: {
        id: party.id,
        displayName: party.display_name,
        nameEn: party.name_en,
        type: party.type,
        email: party.email,
        phone: party.phone,
        status: party.status,
        roles: roleRows.map((row) => row.role_key),
        notes: party.notes,
        source: party.source,
        createdAt: iso(party.created_at) ?? '',
        member: Boolean(party.member),
        address: address
          ? {
              governorate: address.governorate,
              wilayat: address.wilayat,
              city: address.city,
              area: address.area,
              street: address.street,
              buildingNumber: address.building_number,
              postalCode: address.postal_code,
            }
          : null,
      },
      canEdit: hasPermission(claims, 'party.write') && !ownerPartyScope(claims),
      owned: owned.map((row) => ({
        propertyId: row.id,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        category: row.category,
        units: Number(row.units),
        leased: Number(row.leased),
        shareBasisPoints: row.share === null ? null : Number(row.share),
      })),
      leases: leases.map((row) => ({
        ...place(row),
        id: row.id,
        status: row.status,
        startsOn: day(row.starts_on),
        endsOn: day(row.ends_on),
        rentMinor: row.rent_minor,
        currency: row.currency,
        contractId: row.contract_id,
      })),
      contracts: contracts.map((row) => ({
        ...place(row),
        id: row.id,
        reference: row.reference,
        status: row.status,
        side: row.side,
        contractType: row.contract_type === 'sale' ? 'sale' : 'lease',
        createdAt: iso(row.created_at) ?? '',
      })),
      reservations: reservations.map((row) => ({
        ...place(row),
        id: row.id,
        reference: row.reference,
        mode: row.mode === 'sale' ? 'sale' : 'lease',
        status: row.status,
        depositMinor:
          row.deposit_minor && /^\d+$/.test(row.deposit_minor) ? row.deposit_minor : null,
        currency: row.currency,
        paidAt: row.paid_at,
      })),
      stays: stays.map((row) => ({
        ...place(row),
        id: row.id,
        reference: row.reference,
        status: row.status,
        checkInOn: day(row.check_in_on),
        checkOutOn: day(row.check_out_on),
        totalMinor: row.total_minor,
        currency: row.currency,
      })),
      maintenance: maintenance.map((row) => ({
        ...place(row),
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        createdAt: iso(row.created_at) ?? '',
      })),
      legal: legal.map((row) => ({
        id: row.id,
        reference: row.reference,
        title: row.title,
        status: row.status,
        side: row.side,
        claimMinor: row.claim_minor,
        recoveredMinor: row.recovered_minor,
        currency: row.currency,
        nextHearingAt: iso(row.next_hearing_at),
      })),
      tasks: taskRows,
      money,
    };
  });
}

function clean(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function cleanAddress(address: ContactAddress): ContactAddress {
  const governorate = clean(address.governorate, 120);
  const wilayat = clean(address.wilayat, 120);
  const city = clean(address.city, 120);
  if (!governorate || !wilayat || !city) throw new Error('contact_invalid');
  return {
    governorate,
    wilayat,
    city,
    area: clean(address.area, 120),
    street: clean(address.street, 160),
    buildingNumber: clean(address.buildingNumber, 50),
    postalCode: clean(address.postalCode, 24),
  };
}

/** Edits the party's details, roles, address and notes; records which fields changed. */
export async function updateContact(
  claims: SessionClaims,
  partyId: string,
  input: ContactUpdate,
): Promise<{ changed: string[] }> {
  const orgId = requireOrg(claims);
  if (!hasPermission(claims, 'party.write') || ownerPartyScope(claims)) {
    throw new Error('forbidden');
  }
  return withinViewerTenant(claims, async (tx) => {
    const [current] = rows<{
      display_name: string;
      type: string;
      email: string | null;
      phone: string | null;
      status: string;
      notes: string | null;
      name_en: string | null;
    }>(
      await tx.execute(sql`
        select display_name, type, email, phone, status,
          metadata->>'notes' as notes, metadata->>'nameEn' as name_en
        from parties where organization_id = ${orgId} and id = ${partyId}
        for update
      `),
    );
    if (!current) throw new Error('party_not_found');
    const changed: string[] = [];
    const sets: SQL[] = [];

    if (input.displayName !== undefined) {
      const next = clean(input.displayName, 200);
      if (!next) throw new Error('contact_invalid');
      if (next !== current.display_name) {
        changed.push('displayName');
        sets.push(sql`display_name = ${next}`);
      }
    }
    if (input.type !== undefined && input.type !== current.type) {
      if (input.type !== 'person' && input.type !== 'company') throw new Error('contact_invalid');
      changed.push('type');
      sets.push(sql`type = ${input.type}::party_type`);
    }
    if (input.email !== undefined) {
      const next = clean(input.email, 320)?.toLowerCase() ?? null;
      if (next && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) throw new Error('contact_invalid');
      if (next !== (current.email?.toLowerCase() ?? null)) {
        if (next) {
          const [taken] = rows<{ id: string }>(
            await tx.execute(sql`
              select id from parties
              where organization_id = ${orgId} and lower(email) = ${next} and id <> ${partyId}
              limit 1
            `),
          );
          if (taken) throw new Error('contact_email_taken');
        }
        changed.push('email');
        sets.push(sql`email = ${next}`);
      }
    }
    if (input.phone !== undefined) {
      const next = clean(input.phone, 40);
      if (next && !/^\+?[0-9 ()-]{6,40}$/.test(next)) throw new Error('contact_invalid');
      if (next !== current.phone) {
        changed.push('phone');
        sets.push(sql`phone = ${next}`);
      }
    }
    if (input.status !== undefined && input.status !== current.status) {
      if (!['active', 'inactive', 'archived'].includes(input.status)) {
        throw new Error('contact_invalid');
      }
      changed.push('status');
      sets.push(sql`status = ${input.status}::lifecycle_status`);
    }
    if (input.notes !== undefined) {
      const next = (input.notes ?? '').trim().slice(0, 2_000) || null;
      if (next !== current.notes) {
        changed.push('notes');
        sets.push(
          next
            ? sql`metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('notes', ${next}::text)`
            : sql`metadata = coalesce(metadata, '{}'::jsonb) - 'notes'`,
        );
      }
    }
    if (input.nameEn !== undefined) {
      const next = (input.nameEn ?? '').trim().slice(0, 200) || null;
      if (next !== current.name_en) {
        changed.push('nameEn');
        sets.push(
          next
            ? sql`metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('nameEn', ${next}::text)`
            : sql`metadata = coalesce(metadata, '{}'::jsonb) - 'nameEn'`,
        );
      }
    }
    if (sets.length) {
      await tx.execute(sql`
        update parties set ${sql.join(sets, sql`, `)}, updated_at = now()
        where organization_id = ${orgId} and id = ${partyId}
      `);
    }

    if (input.roles !== undefined) {
      const wanted = new Set(
        input.roles.filter((role): role is (typeof CONTACT_ROLE_KEYS)[number] =>
          (CONTACT_ROLE_KEYS as readonly string[]).includes(role),
        ),
      );
      const existing = rows<{ role_key: string; status: string }>(
        await tx.execute(sql`
          select role_key, status from party_roles
          where organization_id = ${orgId} and party_id = ${partyId}
        `),
      );
      let rolesChanged = false;
      for (const role of CONTACT_ROLE_KEYS) {
        const row = existing.find((item) => item.role_key === role);
        const want = wanted.has(role);
        if (want && !row) {
          await tx.execute(sql`
            insert into party_roles (organization_id, party_id, role_key, status)
            values (${orgId}, ${partyId}, ${role}, 'active')
          `);
          rolesChanged = true;
        } else if (row && want !== (row.status === 'active')) {
          await tx.execute(sql`
            update party_roles set status = ${want ? 'active' : 'inactive'}::lifecycle_status,
              updated_at = now()
            where organization_id = ${orgId} and party_id = ${partyId} and role_key = ${role}
          `);
          rolesChanged = true;
        }
      }
      if (rolesChanged) changed.push('roles');
    }

    if (input.address !== undefined) {
      const [link] = rows<{ address_id: string }>(
        await tx.execute(sql`
          select address_id from party_addresses
          where organization_id = ${orgId} and party_id = ${partyId}
          order by "primary" desc, created_at
          limit 1
        `),
      );
      if (input.address === null) {
        if (link) {
          await tx.execute(sql`
            delete from party_addresses
            where organization_id = ${orgId} and party_id = ${partyId} and address_id = ${link.address_id}
          `);
          changed.push('address');
        }
      } else {
        const next = cleanAddress(input.address);
        if (link) {
          const [updated] = rows<{ id: string }>(
            await tx.execute(sql`
              update addresses set governorate = ${next.governorate}, wilayat = ${next.wilayat},
                city = ${next.city}, area = ${next.area}, street = ${next.street},
                building_number = ${next.buildingNumber}, postal_code = ${next.postalCode},
                updated_at = now()
              where organization_id = ${orgId} and id = ${link.address_id}
                and (governorate, wilayat, city, coalesce(area, ''), coalesce(street, ''),
                  coalesce(building_number, ''), coalesce(postal_code, ''))
                  is distinct from
                  (${next.governorate}, ${next.wilayat}, ${next.city}, ${next.area ?? ''},
                  ${next.street ?? ''}, ${next.buildingNumber ?? ''}, ${next.postalCode ?? ''})
              returning id
            `),
          );
          if (updated) changed.push('address');
        } else {
          const [created] = rows<{ id: string }>(
            await tx.execute(sql`
              insert into addresses (organization_id, governorate, wilayat, city, area, street,
                building_number, postal_code)
              values (${orgId}, ${next.governorate}, ${next.wilayat}, ${next.city}, ${next.area},
                ${next.street}, ${next.buildingNumber}, ${next.postalCode})
              returning id
            `),
          );
          await tx.execute(sql`
            insert into party_addresses (organization_id, party_id, address_id, label, "primary")
            values (${orgId}, ${partyId}, ${created!.id}, 'primary', true)
          `);
          changed.push('address');
        }
      }
    }

    if (changed.length) {
      await tx.execute(sql`
        insert into workflow_events (organization_id, actor_user_id, resource_type, resource_id,
          event_type, metadata)
        values (${orgId}, ${claims.sub}, 'party', ${partyId}, 'party.updated',
          ${JSON.stringify({ fields: changed })}::jsonb)
      `);
    }
    return { changed };
  });
}
