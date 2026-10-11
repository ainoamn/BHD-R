import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  approvalRequests,
  contractSignatures,
  contractTemplates,
  contracts,
  leases,
  parties,
  properties,
  stayBookingStatusHistory,
  units,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  bookingTermsDocument,
  termsBlocksFromStored,
  type BookingTermsMode,
  type TermsLetterhead,
} from '@/lib/booking-terms';
import { readTermsLetterhead } from '@/lib/booking-terms-neon';
import {
  CONTRACT_FILE_FIELDS,
  sanitizeContractHtml,
  type ContractDocument,
  type ContractFileKind,
} from '@/lib/contract-document';
import { formatMoney } from '@/lib/format';
import { ownerPartyScope, readClaims, withinViewerTenant } from '@/lib/portal-ops-data';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

export interface ContractDetail {
  id: string;
  reference: string;
  kind: 'initial' | 'renewal' | 'amendment' | 'termination';
  parentContractId: string | null;
  status: string;
  startsOn: string;
  endsOn: string;
  documentUrl: string | null;
  documentHash: string | null;
  canSign: boolean;
  approval: {
    id: string;
    reference: string;
    status: string;
    decisionNote: string | null;
    decidedAt: string | null;
  } | null;
  parties: {
    owner: { id: string; displayName: string } | null;
    tenant: { id: string; displayName: string } | null;
  };
  property: { id: string; nameAr: string; nameEn: string } | null;
  unit: { id: string; code: string; nameAr: string; nameEn: string } | null;
  signatures: Array<{
    id: string;
    signerRole: string;
    signatureHash: string;
    signedAt: string;
  }>;
  /** Full document view; only the Neon reader fills it. */
  document?: ContractDocument;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENT_URL_TTL_SEC = 180;

const globalForS3 = globalThis as unknown as { __bhdRContractS3?: S3Client };

async function signedDocumentUrl(key: string, reference: string): Promise<string | null> {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.S3_SECRET_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  globalForS3.__bhdRContractS3 ??= new S3Client({
    region: process.env.S3_REGION?.trim() || 'auto',
    forcePathStyle: true,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return getSignedUrl(
    globalForS3.__bhdRContractS3,
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_PRIVATE ?? 'bhd-r-private',
      Key: key,
      ResponseContentDisposition: `inline; filename="${reference}.pdf"`,
    }),
    { expiresIn: DOCUMENT_URL_TTL_SEC },
  ).catch(() => null);
}

type Portal = 'owner' | 'tenant' | 'developer';
type Access = { claims: SessionClaims; orgId: string; partyScope: string | null };

async function contractAccess(contractId: string, portal: Portal): Promise<Access | null> {
  if (!hasDatabaseUrl() || !UUID.test(contractId)) return null;
  const claims = await readClaims();
  if (!claims?.organizationId || !hasPermission(claims, 'contract.read')) return null;
  const partyScope = portal === 'tenant' ? claims.partyId : ownerPartyScope(claims);
  if (portal === 'tenant' && !partyScope) return null;
  return { claims, orgId: claims.organizationId, partyScope };
}

async function visibleContract(tx: Tx, contractId: string, access: Access) {
  const [contract] = await tx
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, access.orgId)))
    .limit(1);
  if (!contract) return null;
  if (
    access.partyScope &&
    ![contract.ownerPartyId, contract.tenantPartyId].includes(access.partyScope)
  ) {
    return null;
  }
  return contract;
}

/** ID photos and selfie: parties to the contract, or staff who manage stay bookings. */
function canViewIdentityFiles(access: Access, contract: { tenantPartyId: string }): boolean {
  return (
    access.claims.partyId === contract.tenantPartyId ||
    hasPermission(access.claims, 'stay.booking.manage')
  );
}

function stayBookingIdOf(snapshot: Record<string, unknown>): string | null {
  const source = snapshot.source as { type?: unknown; stayBookingId?: unknown } | undefined;
  return source?.type === 'stay_booking' && typeof source.stayBookingId === 'string'
    ? source.stayBookingId
    : null;
}

/** Latest e-sign capture; `summaryOnly` swaps each image for `true` so the page never loads the bytes. */
async function latestEsign(tx: Tx, orgId: string, bookingId: string, summaryOnly = false) {
  const esign = summaryOnly
    ? sql<Record<string, unknown> | null>`(
        select jsonb_object_agg(e.key, case when e.key = 'signedAt' then e.value else to_jsonb(jsonb_typeof(e.value) = 'string') end)
        from jsonb_each(${stayBookingStatusHistory.metadataJson}->'esign') as e
      )`
    : sql<Record<string, unknown> | null>`${stayBookingStatusHistory.metadataJson}->'esign'`;
  const [row] = await tx
    .select({ esign })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, orgId),
        eq(stayBookingStatusHistory.bookingId, bookingId),
        sql`${stayBookingStatusHistory.metadataJson}->'esign' is not null`,
      ),
    )
    .orderBy(desc(stayBookingStatusHistory.createdAt))
    .limit(1);
  return row?.esign ?? null;
}

/** One e-sign capture (signature / ID / selfie) as image bytes, after the same access checks as the page. */
export async function readContractFile(
  contractId: string,
  portal: Portal,
  kind: ContractFileKind,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const access = await contractAccess(contractId, portal);
  if (!access) return null;
  const dataUrl = await withinViewerTenant(access.claims, async (tx) => {
    const contract = await visibleContract(tx, contractId, access);
    if (!contract) return null;
    if (kind !== 'signature' && !canViewIdentityFiles(access, contract)) return null;
    const bookingId = stayBookingIdOf((contract.payloadSnapshot ?? {}) as Record<string, unknown>);
    if (!bookingId) return null;
    const esign = await latestEsign(tx, access.orgId, bookingId);
    const value = esign?.[CONTRACT_FILE_FIELDS[kind]];
    return typeof value === 'string' ? value : null;
  });
  const match = dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') };
}

/**
 * Contract detail straight from Neon, matching `GET /v1/leasing/contracts/:id`,
 * plus the full document (terms, signatures, files, addenda).
 * Returns null when it cannot answer (no DB, no permission, not visible to this
 * party) so the caller can fall back to Nest.
 */
export async function loadContractDetailFromNeon(
  contractId: string,
  portal: Portal,
): Promise<ContractDetail | null> {
  const access = await contractAccess(contractId, portal);
  if (!access) return null;
  const { claims, orgId } = access;

  const detail = await withinViewerTenant(claims, async (tx) => {
    const contract = await visibleContract(tx, contractId, access);
    if (!contract) return null;

    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const stayBookingId = stayBookingIdOf(snapshot);
    const linkedContractId = contract.kind === 'renewal' ? contract.parentContractId : contract.id;
    const [template, letterhead, addenda, parent, esign] = await Promise.all([
      tx
        .select({ html: contractTemplates.html })
        .from(contractTemplates)
        .where(
          and(
            eq(contractTemplates.organizationId, orgId),
            eq(contractTemplates.id, contract.templateVersionId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      readTermsLetterhead(tx, orgId).catch(() => null),
      tx
        .select({
          id: contracts.id,
          reference: contracts.reference,
          kind: contracts.kind,
          status: contracts.status,
          createdAt: contracts.createdAt,
        })
        .from(contracts)
        .where(
          and(eq(contracts.organizationId, orgId), eq(contracts.parentContractId, contract.id)),
        )
        .orderBy(contracts.createdAt),
      contract.parentContractId
        ? tx
            .select({ id: contracts.id, reference: contracts.reference })
            .from(contracts)
            .where(
              and(eq(contracts.organizationId, orgId), eq(contracts.id, contract.parentContractId)),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      stayBookingId ? latestEsign(tx, orgId, stayBookingId, true) : Promise.resolve(null),
    ]);
    const [lease, owner, tenant, unit, signatures, approval] = await Promise.all([
      linkedContractId
        ? tx
            .select({ startsOn: leases.startsOn, endsOn: leases.endsOn })
            .from(leases)
            .where(and(eq(leases.organizationId, orgId), eq(leases.contractId, linkedContractId)))
            .limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
      tx
        .select({ id: parties.id, displayName: parties.displayName })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, contract.ownerPartyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select({ id: parties.id, displayName: parties.displayName })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, contract.tenantPartyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select({
          id: units.id,
          code: units.code,
          nameAr: units.nameAr,
          nameEn: units.nameEn,
          propertyId: units.propertyId,
        })
        .from(units)
        .where(and(eq(units.organizationId, orgId), eq(units.id, contract.unitId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select({
          id: contractSignatures.id,
          signerPartyId: contractSignatures.signerPartyId,
          signerRole: contractSignatures.signerRole,
          method: contractSignatures.method,
          evidence: contractSignatures.evidence,
          signatureHash: contractSignatures.signatureHash,
          signedAt: contractSignatures.signedAt,
        })
        .from(contractSignatures)
        .where(
          and(
            eq(contractSignatures.organizationId, orgId),
            eq(contractSignatures.contractId, contract.id),
          ),
        )
        .orderBy(contractSignatures.signedAt),
      tx
        .select({
          id: approvalRequests.id,
          reference: approvalRequests.reference,
          status: approvalRequests.status,
          decisionNote: approvalRequests.decisionNote,
          decidedAt: approvalRequests.decidedAt,
        })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.organizationId, orgId),
            eq(approvalRequests.resourceType, 'contract'),
            eq(approvalRequests.resourceId, contract.id),
          ),
        )
        .orderBy(desc(approvalRequests.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
    const property = unit
      ? await tx
          .select({ id: properties.id, nameAr: properties.nameAr, nameEn: properties.nameEn })
          .from(properties)
          .where(and(eq(properties.organizationId, orgId), eq(properties.id, unit.propertyId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    return {
      contract,
      lease,
      owner,
      tenant,
      unit,
      property,
      signatures,
      approval,
      template,
      letterhead,
      addenda,
      parent,
      esign,
      stayBookingId,
      showIdentityFiles: canViewIdentityFiles(access, contract),
    };
  });
  if (!detail) return null;

  const { contract, lease, owner, tenant, unit, property, signatures, approval } = detail;
  const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
  const reference = contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`;
  const signerPartyId = claims.partyId;
  const document = await buildContractDocument(detail, snapshot, orgId);
  return {
    document,
    id: contract.id,
    reference,
    kind: contract.kind as ContractDetail['kind'],
    parentContractId: contract.parentContractId,
    status: contract.status,
    startsOn: typeof snapshot.startsOn === 'string' ? snapshot.startsOn : (lease?.startsOn ?? ''),
    endsOn: typeof snapshot.endsOn === 'string' ? snapshot.endsOn : (lease?.endsOn ?? ''),
    documentUrl: contract.renderedPdfObjectKey
      ? await signedDocumentUrl(contract.renderedPdfObjectKey, reference)
      : null,
    documentHash: contract.renderedPdfHash,
    canSign:
      Boolean(signerPartyId) &&
      [contract.ownerPartyId, contract.tenantPartyId].includes(signerPartyId!) &&
      Boolean(contract.renderedPdfHash) &&
      ['sent', 'partially_signed'].includes(contract.status) &&
      !signatures.some((signature) => signature.signerPartyId === signerPartyId),
    approval: approval
      ? {
          ...approval,
          decidedAt: approval.decidedAt ? approval.decidedAt.toISOString() : null,
        }
      : null,
    parties: { owner, tenant },
    property,
    unit: unit ? { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn } : null,
    signatures: signatures.map((signature) => ({
      id: signature.id,
      signerRole: signature.signerRole,
      signatureHash: signature.signatureHash,
      signedAt: signature.signedAt.toISOString(),
    })),
  };
}

type Loaded = {
  contract: typeof contracts.$inferSelect;
  tenant: { id: string; displayName: string } | null;
  signatures: Array<{
    id: string;
    signerRole: string;
    method: string;
    evidence: unknown;
    signatureHash: string;
    signedAt: Date;
  }>;
  template: { html: string } | null;
  letterhead: TermsLetterhead | null;
  addenda: Array<{
    id: string;
    reference: string | null;
    kind: string;
    status: string;
    createdAt: Date;
  }>;
  parent: { id: string; reference: string | null } | null;
  esign: Record<string, unknown> | null;
  stayBookingId: string | null;
  showIdentityFiles: boolean;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

function money(value: unknown): { amountMinor: string; currency: string } | null {
  const row = record(value);
  const amountMinor = text(row.amountMinor);
  const currency = text(row.currency);
  return amountMinor && currency ? { amountMinor, currency } : null;
}

const TERMS_MODES = new Set<BookingTermsMode>(['daily', 'rent', 'sale']);

async function buildContractDocument(
  loaded: Loaded,
  snapshot: Record<string, unknown>,
  orgId: string,
): Promise<ContractDocument> {
  const { contract } = loaded;
  const contractInfo = record(snapshot.contract);
  const source = record(snapshot.source);
  const type: ContractDocument['type'] =
    contractInfo.type === 'sale'
      ? 'sale'
      : loaded.stayBookingId || snapshot.stayType
        ? 'stay'
        : 'lease';

  const tenantSignature = loaded.signatures.find((row) => row.signerRole !== 'owner');
  const tenantEvidence = record(tenantSignature?.evidence);
  const guestContact = record(tenantEvidence.guestContact);

  const stay =
    loaded.stayBookingId && text(source.referenceCode)
      ? await lookupPublicStayBookingOnNeon(text(source.referenceCode)!)
          .then((row) =>
            row && row.organizationId === orgId && row.id === loaded.stayBookingId ? row : null,
          )
          .catch(() => null)
      : null;

  const accepted = record(tenantEvidence.acceptedTerms);
  const hasAccepted = Object.keys(accepted).length > 0 || Boolean(stay?.acceptedTerms);
  const mode: BookingTermsMode = TERMS_MODES.has(accepted.mode as BookingTermsMode)
    ? (accepted.mode as BookingTermsMode)
    : type === 'stay'
      ? 'daily'
      : type === 'sale'
        ? 'sale'
        : 'rent';
  const deposit = money(snapshot.deposit);
  const terms = hasAccepted
    ? bookingTermsDocument({
        mode,
        blocks: Object.keys(accepted).length
          ? termsBlocksFromStored({
              blocks: accepted.blocks,
              bodyAr: text(accepted.bodyAr),
              bodyEn: text(accepted.bodyEn),
            })
          : (stay?.acceptedTerms?.blocks ?? []),
        depositAr: deposit ? formatMoney(deposit.amountMinor, deposit.currency, 'ar') : null,
        depositEn: deposit ? formatMoney(deposit.amountMinor, deposit.currency, 'en') : null,
      })
    : [];

  const esignAt = text(loaded.esign?.signedAt);
  const files: ContractDocument['files'] = loaded.esign
    ? (Object.keys(CONTRACT_FILE_FIELDS) as ContractFileKind[])
        .filter((kind) => kind === 'signature' || loaded.showIdentityFiles)
        .filter((kind) => loaded.esign?.[CONTRACT_FILE_FIELDS[kind]] === true)
        .map((kind) => ({ kind, signedAt: esignAt }))
    : [];

  const approval = record(snapshot.approval);
  return {
    type,
    createdAt: contract.createdAt.toISOString(),
    sentAt: contract.sentAt?.toISOString() ?? null,
    completedAt: contract.completedAt?.toISOString() ?? null,
    templateHtml: sanitizeContractHtml(loaded.template?.html),
    letterhead: loaded.letterhead,
    amount: money(snapshot.amount),
    deposit,
    stayType: text(snapshot.stayType),
    source: Object.keys(source).length
      ? {
          type: text(source.type) ?? 'manual',
          referenceCode: text(source.referenceCode),
          stayBookingId: text(source.stayBookingId),
        }
      : null,
    approval: Object.keys(approval).length
      ? { mode: text(approval.mode), byName: text(approval.byName), at: text(approval.at) }
      : null,
    tenantContact:
      text(guestContact.email) || text(guestContact.phone) || stay
        ? {
            email: text(guestContact.email) ?? stay?.guestEmail ?? null,
            phone: text(guestContact.phone) ?? stay?.guestPhone ?? null,
          }
        : null,
    terms,
    termsAcceptedAt: text(accepted.acceptedAt) ?? null,
    signatures: loaded.signatures.map((row) => {
      const evidence = record(row.evidence);
      const contact = record(evidence.guestContact);
      return {
        id: row.id,
        role: row.signerRole,
        method: row.method,
        name:
          text(evidence.signedByName) ??
          text(contact.displayName) ??
          (row.signerRole === 'owner' ? null : (loaded.tenant?.displayName ?? null)),
        email: text(evidence.signedByEmail) ?? text(contact.email),
        signedAt: row.signedAt.toISOString(),
        hash: row.signatureHash,
      };
    }),
    files,
    stay: stay
      ? {
          status: stay.status,
          nights: stay.nights ?? null,
          adults: stay.adults ?? null,
          children: stay.children ?? null,
          checkIn: stay.checkIn ? { at: stay.checkIn.at, notes: stay.checkIn.notes } : null,
          checkOut: stay.checkOut ? { at: stay.checkOut.at, notes: stay.checkOut.notes } : null,
          guestPageHref: `/guest/stays/${stay.id}?ref=${encodeURIComponent(stay.referenceCode)}`,
        }
      : null,
    addenda: loaded.addenda.map((row) => ({
      id: row.id,
      reference: row.reference ?? `CTR-${row.id.slice(0, 8).toUpperCase()}`,
      kind: row.kind,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    parent: loaded.parent
      ? {
          id: loaded.parent.id,
          reference: loaded.parent.reference ?? `CTR-${loaded.parent.id.slice(0, 8).toUpperCase()}`,
        }
      : null,
  };
}
