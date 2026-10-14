import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  cheques,
  contracts,
  invoiceLines,
  leases,
  parties,
  payments,
  properties,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readTermsLetterhead } from '@/lib/booking-terms-neon';
import { contractQrSvg } from '@/lib/contract-verify';
import { elevatedTx, type ElevatedTx } from '@/lib/elevated-db';
import { ownerPartyScope } from '@/lib/portal-ops-data';
import {
  findRentDocSubject,
  isRentDocKey,
  rentDocKindsOf,
  rentDocNumber,
  type RentDocKind,
  type RentDocSubject,
} from '@/lib/rent-documents';
import { publicWebOrigin } from '@/lib/seo';
import { findTenancyLease, leaseStatementsInTx } from '@/lib/tenancy-neon';
import { canChargeTenants, canRecordTenantPayments } from '@/lib/tenant-charges-neon';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_VERSION = 1;
export const RENT_PAYMENT_EVENT = 'rent.payment_recorded';

export type RentDocViewer =
  { type: 'tenant'; userId: string } | { type: 'staff'; claims: SessionClaims };

export type RentDocPayment = {
  id: string;
  receivedAt: string;
  method: string;
  amountMinor: string;
  reference: string | null;
  recordedBy: string | null;
};

export type RentDocument = {
  kind: RentDocKind;
  number: string;
  leaseId: string;
  subject: RentDocSubject;
  description: string | null;
  currency: string;
  issuer: { nameAr: string; nameEn: string; logoDataUrl: string | null; phone: string };
  tenantName: string;
  property: { nameAr: string; nameEn: string } | null;
  unit: { code: string; nameAr: string; nameEn: string } | null;
  contractReference: string | null;
  lease: {
    startsOn: string;
    endsOn: string;
    rentMinor: string;
    status: string;
    installments: number;
  };
  payments: RentDocPayment[];
  chequeClearedAt: string | null;
  /** When the receipt's last payment came in, or when the demand was produced. */
  issuedAt: string;
  signature: {
    fingerprint: string;
    code: string;
    signedAt: string;
    verifyUrl: string;
    qrSvg: string;
  };
};

type Access = { orgId: string; tenantPartyId: string };

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function day(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

/** The tenant on the lease, or staff of its organization who bill or collect from tenants. */
async function authorize(viewer: RentDocViewer, leaseId: string): Promise<Access | null> {
  if (viewer.type === 'tenant') {
    const lease = await findTenancyLease(viewer.userId, leaseId);
    return lease ? { orgId: lease.link.organizationId, tenantPartyId: lease.link.partyId } : null;
  }
  const { claims } = viewer;
  if (
    !claims.organizationId ||
    !(
      canRecordTenantPayments(claims) ||
      canChargeTenants(claims) ||
      hasPermission(claims, 'invoice.read')
    )
  ) {
    return null;
  }
  const [row] = await elevatedTx((tx) =>
    tx
      .select({
        orgId: leases.organizationId,
        tenantPartyId: leases.tenantPartyId,
        ownerPartyId: properties.ownerPartyId,
      })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(eq(leases.id, leaseId))
      .limit(1),
  );
  if (!row || row.orgId !== claims.organizationId) return null;
  const scoped = ownerPartyScope(claims);
  if (scoped && row.ownerPartyId !== scoped) return null;
  return { orgId: row.orgId, tenantPartyId: row.tenantPartyId };
}

/** SHA-256 over everything the document attests; any change to the amounts gives a new one. */
function fingerprintOf(input: {
  kind: RentDocKind;
  number: string;
  leaseId: string;
  currency: string;
  subject: RentDocSubject;
  payments: RentDocPayment[];
  chequeClearedAt: string | null;
}): string {
  const { subject } = input;
  return createHash('sha256')
    .update(
      JSON.stringify({
        v: SIGNATURE_VERSION,
        kind: input.kind,
        number: input.number,
        lease: input.leaseId,
        key: subject.key,
        currency: input.currency,
        amount: subject.amountMinor,
        paid: subject.paidMinor,
        left: subject.outstandingMinor,
        due: subject.dueOn,
        from: subject.periodFrom,
        to: subject.periodTo,
        payments: input.payments.map((payment) => [payment.id, payment.amountMinor]),
        cleared: input.chequeClearedAt,
      }),
    )
    .digest('hex');
}

/**
 * Checksum over the token and data never shown publicly (when the lease was created), so a lease
 * id alone cannot be turned into verification links. No secret: printed codes survive key rotation.
 */
function tokenCheck(body: string, leaseCreatedAt: Date): string {
  return createHash('sha256')
    .update(`bhd-r:rent-doc:${body}:${leaseCreatedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 8);
}

/** What the QR code carries: lease, line, kind, the start of the fingerprint and a checksum. */
export function rentDocToken(
  leaseId: string,
  leaseCreatedAt: Date,
  key: string,
  kind: RentDocKind,
  fingerprint: string,
): string {
  const body = `${leaseId.replace(/-/g, '').toLowerCase()}_${key}_${kind === 'receipt' ? 'r' : 'i'}_${fingerprint.slice(0, 16)}`;
  return `${body}_${tokenCheck(body, leaseCreatedAt)}`;
}

export function parseRentDocToken(token: string): {
  body: string;
  check: string;
  leaseId: string;
  key: string;
  kind: RentDocKind;
  fingerprint: string;
} | null {
  let raw: string;
  try {
    raw = decodeURIComponent(token).toLowerCase();
  } catch {
    return null;
  }
  const match = /^(([0-9a-f]{32})_([a-z0-9-]{3,48})_([ri])_([0-9a-f]{16}))_([0-9a-f]{8})$/.exec(
    raw,
  );
  if (!match || !isRentDocKey(match[3]!)) return null;
  const hex = match[2]!;
  return {
    body: match[1]!,
    check: match[6]!,
    leaseId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    key: match[3]!,
    kind: match[4] === 'r' ? 'receipt' : 'invoice',
    fingerprint: match[5]!,
  };
}

export function rentDocVerifyUrl(token: string): string {
  return `${publicWebOrigin()}/verify/document/${token}`;
}

/**
 * The document as of now. With `anyKind` it is built even when the kind no longer applies (a
 * demand invoice that has since been paid), for the verification page.
 */
async function buildDocument(
  tx: ElevatedTx,
  access: Access,
  leaseId: string,
  key: string,
  kind: RentDocKind,
  anyKind = false,
): Promise<RentDocument | null> {
  const { orgId, tenantPartyId } = access;
  const statement = (await leaseStatementsInTx(tx, orgId, [leaseId], tenantPartyId)).get(leaseId);
  if (!statement) return null;
  const subject = findRentDocSubject(statement.statement, key);
  if (!subject || (!anyKind && !rentDocKindsOf(subject).includes(kind))) return null;

  const [detail] = await tx
    .select({
      createdAt: leases.createdAt,
      startsOn: leases.startsOn,
      endsOn: leases.endsOn,
      rentMinor: leases.rentMinor,
      status: leases.status,
      currency: leases.currency,
      unitCode: units.code,
      unitAr: units.nameAr,
      unitEn: units.nameEn,
      propertyAr: properties.nameAr,
      propertyEn: properties.nameEn,
      contractReference: contracts.reference,
      installments: sql<number>`coalesce(jsonb_array_length(${contracts.payloadSnapshot}->'leaseTerms'->'schedule'), 0)`,
      tenantNameAr: sql<string | null>`${contracts.payloadSnapshot}->'tenantDetails'->>'nameAr'`,
      tenantName: parties.displayName,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .leftJoin(properties, eq(properties.id, units.propertyId))
    .leftJoin(contracts, eq(contracts.id, leases.contractId))
    .leftJoin(parties, eq(parties.id, leases.tenantPartyId))
    .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
    .limit(1);
  if (!detail) return null;

  const paymentRows = subject.invoiceId
    ? await tx
        .select({
          id: payments.id,
          receivedAt: payments.receivedAt,
          method: payments.method,
          amountMinor: payments.amountMinor,
          status: payments.status,
        })
        .from(payments)
        .where(and(eq(payments.organizationId, orgId), eq(payments.invoiceId, subject.invoiceId)))
        .orderBy(asc(payments.receivedAt))
    : [];
  const succeeded = paymentRows.filter((row) => row.status === 'succeeded');
  const notes = succeeded.length
    ? await tx
        .select({
          paymentId: sql<string | null>`${workflowEvents.metadata}->>'paymentId'`,
          reference: sql<string | null>`${workflowEvents.metadata}->>'reference'`,
          recordedBy: users.displayName,
        })
        .from(workflowEvents)
        .leftJoin(users, eq(users.id, workflowEvents.actorUserId))
        .where(
          and(
            eq(workflowEvents.organizationId, orgId),
            eq(workflowEvents.resourceType, 'invoice'),
            eq(workflowEvents.resourceId, subject.invoiceId!),
            inArray(workflowEvents.eventType, [
              RENT_PAYMENT_EVENT,
              'tenant_charge.payment_recorded',
            ]),
          ),
        )
    : [];
  const paymentList: RentDocPayment[] = succeeded.map((row) => {
    const note = notes.find((item) => item.paymentId === row.id);
    return {
      id: row.id,
      receivedAt: row.receivedAt.toISOString(),
      method: row.method,
      amountMinor: row.amountMinor.toString(),
      reference: note?.reference ?? null,
      recordedBy: note?.recordedBy ?? null,
    };
  });

  const [cheque] =
    subject.chequeStatus === 'cleared' && subject.chequeNumber
      ? await tx
          .select({ reviewedAt: cheques.reviewedAt, updatedAt: cheques.updatedAt })
          .from(cheques)
          .where(
            and(
              eq(cheques.organizationId, orgId),
              eq(cheques.leaseId, leaseId),
              eq(cheques.chequeNumber, subject.chequeNumber),
            ),
          )
          .limit(1)
      : [];
  const chequeClearedAt = cheque ? iso(cheque.reviewedAt ?? cheque.updatedAt) : null;

  const [descriptionRow] = subject.invoiceId
    ? await tx
        .select({ description: invoiceLines.description })
        .from(invoiceLines)
        .where(
          and(
            eq(invoiceLines.organizationId, orgId),
            eq(invoiceLines.invoiceId, subject.invoiceId),
          ),
        )
        .limit(1)
    : [];
  const letterhead = await readTermsLetterhead(tx, orgId).catch(() => null);

  const number = rentDocNumber(kind, detail.contractReference, leaseId, key);
  const fingerprint = fingerprintOf({
    kind,
    number,
    leaseId,
    currency: detail.currency,
    subject,
    payments: paymentList,
    chequeClearedAt,
  });
  const lastPaid = [...paymentList.map((payment) => payment.receivedAt), chequeClearedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const issuedAt = kind === 'receipt' && lastPaid ? lastPaid : new Date().toISOString();
  const verifyUrl = rentDocVerifyUrl(
    rentDocToken(leaseId, detail.createdAt, key, kind, fingerprint),
  );

  return {
    kind,
    number,
    leaseId,
    subject,
    description: descriptionRow?.description ?? null,
    currency: detail.currency,
    issuer: {
      nameAr: letterhead?.nameAr || 'BHD R',
      nameEn: letterhead?.nameEn || letterhead?.nameAr || 'BHD R',
      logoDataUrl: letterhead?.logoDataUrl ?? null,
      phone: letterhead?.phone ?? '',
    },
    tenantName: detail.tenantNameAr?.trim() || detail.tenantName || '—',
    property: detail.propertyAr
      ? { nameAr: detail.propertyAr, nameEn: detail.propertyEn ?? detail.propertyAr }
      : null,
    unit: { code: detail.unitCode, nameAr: detail.unitAr, nameEn: detail.unitEn },
    contractReference: detail.contractReference,
    lease: {
      startsOn: day(detail.startsOn),
      endsOn: day(detail.endsOn),
      rentMinor: detail.rentMinor.toString(),
      status: detail.status,
      installments: Number(detail.installments) || 0,
    },
    payments: paymentList,
    chequeClearedAt,
    issuedAt,
    signature: {
      fingerprint,
      code: fingerprint
        .slice(0, 16)
        .toUpperCase()
        .replace(/(.{4})(?=.)/g, '$1-'),
      signedAt: issuedAt,
      verifyUrl,
      qrSvg: await contractQrSvg(verifyUrl),
    },
  };
}

/** A receipt or demand invoice the viewer may open, or null when it does not exist for them. */
export async function loadRentDocument(
  viewer: RentDocViewer,
  leaseId: string,
  key: string,
  kind: RentDocKind,
): Promise<RentDocument | null> {
  if (!hasDatabaseUrl() || !UUID.test(leaseId) || !isRentDocKey(key)) return null;
  const access = await authorize(viewer, leaseId);
  if (!access) return null;
  return elevatedTx((tx) => buildDocument(tx, access, leaseId, key, kind));
}

export type RentDocVerdict = 'valid' | 'settled' | 'changed';

export type RentDocVerification = {
  verdict: RentDocVerdict;
  document: RentDocument;
};

/**
 * Public check of a printed document from its QR code. The document is rebuilt from the records:
 * `valid` when nothing changed since it was printed, `settled` for a demand invoice paid since,
 * `changed` when the amounts moved on (a later partial payment, for instance).
 */
export async function loadRentDocumentVerification(
  token: string,
): Promise<RentDocVerification | null> {
  if (!hasDatabaseUrl()) return null;
  const parsed = parseRentDocToken(token);
  if (!parsed) return null;
  return elevatedTx(async (tx) => {
    const [lease] = await tx
      .select({
        orgId: leases.organizationId,
        tenantPartyId: leases.tenantPartyId,
        createdAt: leases.createdAt,
      })
      .from(leases)
      .where(eq(leases.id, parsed.leaseId))
      .limit(1);
    if (!lease || tokenCheck(parsed.body, lease.createdAt) !== parsed.check) return null;
    const document = await buildDocument(
      tx,
      { orgId: lease.orgId, tenantPartyId: lease.tenantPartyId },
      parsed.leaseId,
      parsed.key,
      parsed.kind,
      true,
    );
    if (!document) return null;
    const verdict: RentDocVerdict = document.signature.fingerprint.startsWith(parsed.fingerprint)
      ? 'valid'
      : parsed.kind === 'invoice' && document.subject.outstandingMinor === '0'
        ? 'settled'
        : 'changed';
    return { verdict, document };
  });
}
