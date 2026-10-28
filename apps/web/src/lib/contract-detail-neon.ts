import 'server-only';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  approvalRequests,
  contractSignatures,
  contractTemplates,
  contracts,
  leases,
  parties,
  partyIdentityDocuments,
  properties,
  propertyProfiles,
  stayBookingStatusHistory,
  stayBookings,
  stayProfiles,
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
  type ContractPartyCard,
  type ContractPremises,
  type PropertyLocation,
} from '@/lib/contract-document';
import { loadPropertyLocation } from '@/lib/property-location-neon';
import { defaultTemplateCounterpart } from '@/lib/contract-default-templates';
import { formatMoney } from '@/lib/format';
import { ownerPartyScope, readClaims, withinViewerTenant } from '@/lib/portal-ops-data';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import {
  contractQrSvg,
  contractVerifyToken,
  contractVerifyUrl,
  signatureSerials,
} from '@/lib/contract-verify';
import { loadStayStamps, type StayStamps } from '@/lib/stay-arrival-neon';
import { resolveStayPeriodTimes, type StayPeriodType } from '@/lib/stay-period-times';
import { tenantClaimsForContract } from '@/lib/tenancy-neon';
import { loadDepositRefunds } from '@/lib/stay-deposit-refund-neon';
import { contractAnnexLinks, leaseAnnexLinks } from '@/lib/contract-annex';
import { leaseBookingAgreement, type LeaseBookingAgreement } from '@/lib/lease-booking-contract';
import { leaseBookingDocumentPath } from '@/lib/lease-booking-paths';
import { publicWebOrigin } from '@/lib/seo';
import { loadLeaseBookingAgreementInTx } from '@/lib/public-lease-booking-neon';
import { readStayTypeFromSnapshot } from '@/lib/stay-booking-dates';
import type { ContractArticleHead } from '@/components/contract-document-view';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

const PARTY_COLUMNS = {
  id: parties.id,
  displayName: parties.displayName,
  type: parties.type,
  email: parties.email,
  phone: parties.phone,
};

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
  /** Documents the tenant must attach on a renewal addendum. */
  renewalRequirements?:
    | Array<{
        code: string;
        labelAr: string;
        labelEn: string;
        uploaded: boolean;
        fileName: string | null;
        uploadedAt: string | null;
      }>
    | undefined;
  /** Full document view; only the Neon reader fills it. */
  document?: ContractDocument;
  /** Copy of the signed booking agreement a website rent or purchase contract completes. */
  bookingCopy?: {
    head: ContractArticleHead;
    doc: ContractDocument;
    signaturePng: string | null;
  } | null;
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
export type ContractAccess = {
  claims: SessionClaims;
  orgId: string;
  partyScope: string | null;
  /** Tenant reading a contract held in another organization than the session's. */
  crossOrganization?: boolean;
};
type Access = ContractAccess;

export async function contractAccess(contractId: string, portal: Portal): Promise<Access | null> {
  if (!hasDatabaseUrl() || !UUID.test(contractId)) return null;
  const claims = await readClaims();
  if (!claims) return null;
  if (portal === 'tenant') {
    // The tenant record usually lives in the landlord's organization, not the session's.
    const tenant = await tenantClaimsForContract(claims, contractId);
    if (tenant?.organizationId && tenant.partyId) {
      return {
        claims: tenant,
        orgId: tenant.organizationId,
        partyScope: tenant.partyId,
        crossOrganization: tenant.organizationId !== claims.organizationId,
      };
    }
    if (!claims.roles.includes('tenant')) return null;
  }
  if (!claims.organizationId || !hasPermission(claims, 'contract.read')) return null;
  const partyScope = portal === 'tenant' ? claims.partyId : ownerPartyScope(claims);
  if (portal === 'tenant' && !partyScope) return null;
  return { claims, orgId: claims.organizationId, partyScope };
}

export async function visibleContract(tx: Tx, contractId: string, access: Access) {
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

export function stayBookingIdOf(snapshot: Record<string, unknown>): string | null {
  const source = snapshot.source as { type?: unknown; stayBookingId?: unknown } | undefined;
  if (typeof source?.stayBookingId !== 'string') return null;
  return source.type === 'stay_booking' || source.type === 'stay_booking_reschedule'
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

    let snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    let stayBookingId = stayBookingIdOf(snapshot);
    // Parent may still be open if check-out happened before auto-close existed.
    if (stayBookingId && !contract.parentContractId) {
      try {
        const { closeStayContractAfterCheckoutInTx } = await import(
          '@/lib/stay-contract-close-neon'
        );
        const closed = await closeStayContractAfterCheckoutInTx(tx, {
          organizationId: orgId,
          bookingId: stayBookingId,
          actorUserId: claims.sub,
          recordedBy: 'contract_detail_repair',
        });
        if (closed.repaired || closed.terminationId) {
          const [refreshed] = await tx
            .select()
            .from(contracts)
            .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, orgId)))
            .limit(1);
          if (refreshed) {
            Object.assign(contract, refreshed);
            snapshot = (refreshed.payloadSnapshot ?? {}) as Record<string, unknown>;
            stayBookingId = stayBookingIdOf(snapshot);
          }
        }
      } catch (error) {
        console.error('stay checkout close on contract detail', error);
      }
    }
    const linkedContractId =
      contract.kind === 'renewal' || contract.kind === 'amendment'
        ? contract.parentContractId
        : contract.id;
    const [template, letterhead, addenda, parent, esign] = await Promise.all([
      tx
        .select({
          html: contractTemplates.html,
          key: contractTemplates.key,
          version: contractTemplates.version,
          language: contractTemplates.language,
        })
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
        .select(PARTY_COLUMNS)
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, contract.ownerPartyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select(PARTY_COLUMNS)
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
          floor: units.floor,
          bedrooms: units.bedrooms,
          bathrooms: units.bathrooms,
          majlis: units.majlis,
          halls: units.halls,
          kitchens: units.kitchens,
          hasPool: units.hasPool,
          areaSquareMeters: units.areaSquareMeters,
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
    const [propertyRow, identityDocs, templateSibling, stamps, refund, location, stayProfileRow] =
      await Promise.all([
        unit
          ? tx
              .select({
                id: properties.id,
                nameAr: properties.nameAr,
                nameEn: properties.nameEn,
                kind: properties.kind,
                category: properties.category,
                serialNumber: properties.serialNumber,
                governorate: addresses.governorate,
                wilayat: addresses.wilayat,
                city: addresses.city,
                area: addresses.area,
                street: addresses.street,
                buildingNumber: addresses.buildingNumber,
                postalCode: addresses.postalCode,
                deedNumber: propertyProfiles.deedNumber,
                plotNumber: propertyProfiles.plotNumber,
                furnishing: propertyProfiles.furnishing,
                parkingSpaces: propertyProfiles.parkingSpaces,
                builtUpArea: propertyProfiles.builtUpAreaSquareMeters,
                floorsCount: propertyProfiles.floorsCount,
                yearBuilt: propertyProfiles.yearBuilt,
              })
              .from(properties)
              .innerJoin(
                addresses,
                and(eq(addresses.id, properties.addressId), eq(addresses.organizationId, orgId)),
              )
              .leftJoin(
                propertyProfiles,
                and(
                  eq(propertyProfiles.propertyId, properties.id),
                  eq(propertyProfiles.organizationId, orgId),
                ),
              )
              .where(and(eq(properties.organizationId, orgId), eq(properties.id, unit.propertyId)))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        tx
          .select({
            partyId: partyIdentityDocuments.partyId,
            documentType: partyIdentityDocuments.documentType,
            last4: partyIdentityDocuments.numberLast4,
          })
          .from(partyIdentityDocuments)
          .where(
            and(
              eq(partyIdentityDocuments.organizationId, orgId),
              inArray(partyIdentityDocuments.partyId, [
                contract.ownerPartyId,
                contract.tenantPartyId,
              ]),
            ),
          )
          .orderBy(desc(partyIdentityDocuments.createdAt)),
        template
          ? tx
              .select({ html: contractTemplates.html })
              .from(contractTemplates)
              .where(
                and(
                  eq(contractTemplates.organizationId, orgId),
                  eq(contractTemplates.key, template.key),
                  eq(contractTemplates.version, template.version),
                  ne(contractTemplates.language, template.language),
                ),
              )
              .limit(1)
              .then((rows) => rows[0]?.html ?? null)
          : Promise.resolve(null),
        stayBookingId
          ? loadStayStamps(tx, orgId, [stayBookingId]).then((map) => map.get(stayBookingId) ?? null)
          : Promise.resolve(null),
        stayBookingId
          ? loadDepositRefunds(tx, orgId, [stayBookingId]).then(
              (map) => map.get(stayBookingId) ?? null,
            )
          : Promise.resolve(null),
        unit ? loadPropertyLocation(tx, orgId, unit.propertyId) : Promise.resolve(null),
        stayBookingId
          ? tx
              .select({
                pricingSnapshotJson: stayBookings.pricingSnapshotJson,
                checkInFrom: stayProfiles.checkInFrom,
                dayUseCheckInFrom: stayProfiles.dayUseCheckInFrom,
                dayUseCheckOutUntil: stayProfiles.dayUseCheckOutUntil,
                overnightCheckOutUntil: stayProfiles.overnightCheckOutUntil,
                checkOutUntil: stayProfiles.checkOutUntil,
              })
              .from(stayBookings)
              .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
              .where(
                and(eq(stayBookings.id, stayBookingId), eq(stayBookings.organizationId, orgId)),
              )
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
      ]);
    const serials = signatures.length
      ? await signatureSerials(tx, orgId, contract.id)
      : new Map<string, string>();
    const snapStayType =
      (typeof snapshot.stayType === 'string' ? snapshot.stayType : null) ??
      (stayProfileRow ? readStayTypeFromSnapshot(stayProfileRow.pricingSnapshotJson) : null);
    const stayPeriodTimes =
      typeof snapshot.checkInTime === 'string' && typeof snapshot.checkOutTime === 'string'
        ? {
            checkInTime: snapshot.checkInTime,
            checkOutTime: snapshot.checkOutTime,
          }
        : stayProfileRow
          ? resolveStayPeriodTimes(snapStayType as StayPeriodType | null, stayProfileRow)
          : null;
    const bookingSource = record(snapshot.source);
    const booking =
      bookingSource.type === 'lease_reservation' && text(bookingSource.reservationId)
        ? await loadLeaseBookingAgreementInTx(tx, orgId, text(bookingSource.reservationId)!).catch(
            (error: unknown) => {
              console.error('contract booking copy failed', error);
              return null;
            },
          )
        : null;
    const builtIn = defaultTemplateCounterpart(template?.html);
    const templateAr =
      template?.language === 'ar' ? template.html : (templateSibling ?? builtIn?.ar ?? null);
    const templateEn =
      template?.language === 'en' ? template.html : (templateSibling ?? builtIn?.en ?? null);
    const property = propertyRow
      ? { id: propertyRow.id, nameAr: propertyRow.nameAr, nameEn: propertyRow.nameEn }
      : null;
    return {
      propertyRow,
      location,
      identityDocs,
      contract,
      lease,
      owner,
      tenant,
      unit,
      property,
      signatures,
      approval,
      template: { ar: templateAr, en: templateEn },
      letterhead,
      addenda,
      parent,
      esign,
      stayBookingId,
      stayPeriodTimes,
      showIdentityFiles: canViewIdentityFiles(access, contract),
      canManageStays: hasPermission(claims, 'stay.booking.manage'),
      serials,
      stamps,
      refundRequestedAt: refund?.requestedAt || null,
      booking,
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
    bookingCopy: detail.booking
      ? {
          ...leaseBookingAgreement(detail.booking),
          signaturePng: detail.booking.signature?.png ?? null,
        }
      : null,
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
      !access.crossOrganization &&
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
    parties: {
      owner: owner ? { id: owner.id, displayName: owner.displayName } : null,
      tenant: tenant ? { id: tenant.id, displayName: tenant.displayName } : null,
    },
    property,
    unit: unit ? { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn } : null,
    signatures: signatures.map((signature) => ({
      id: signature.id,
      signerRole: signature.signerRole,
      signatureHash: signature.signatureHash,
      signedAt: signature.signedAt.toISOString(),
    })),
    ...((): Pick<ContractDetail, 'renewalRequirements'> => {
      const renewalRequirements = renewalRequirementsFromSnapshot(snapshot);
      return renewalRequirements?.length ? { renewalRequirements } : {};
    })(),
  };
}

function renewalRequirementsFromSnapshot(
  snapshot: Record<string, unknown>,
): ContractDetail['renewalRequirements'] {
  if (!Array.isArray(snapshot.requirements) || !snapshot.requirements.length) return undefined;
  const uploads = Array.isArray(snapshot.renewalDocuments)
    ? (snapshot.renewalDocuments as Array<{
        code?: string;
        fileName?: string;
        uploadedAt?: string;
      }>)
    : [];
  const byCode = new Map(
    uploads
      .filter((row) => typeof row.code === 'string')
      .map((row) => [row.code as string, row] as const),
  );
  return snapshot.requirements
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const item = row as { code?: string; labelAr?: string; labelEn?: string };
      const code = typeof item.code === 'string' ? item.code : '';
      if (!code) return null;
      const uploaded = byCode.get(code);
      return {
        code,
        labelAr: typeof item.labelAr === 'string' ? item.labelAr : code,
        labelEn: typeof item.labelEn === 'string' ? item.labelEn : code,
        uploaded: Boolean(uploaded),
        fileName: uploaded?.fileName ?? null,
        uploadedAt: uploaded?.uploadedAt ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

type Loaded = {
  contract: typeof contracts.$inferSelect;
  tenant: PartyRow | null;
  signatures: Array<{
    id: string;
    signerRole: string;
    method: string;
    evidence: unknown;
    signatureHash: string;
    signedAt: Date;
  }>;
  template: { ar: string | null; en: string | null };
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
  stayPeriodTimes: { checkInTime: string; checkOutTime: string } | null;
  showIdentityFiles: boolean;
  canManageStays: boolean;
  serials: Map<string, string>;
  stamps: StayStamps | null;
  refundRequestedAt: string | null;
  owner: PartyRow | null;
  unit: {
    code: string;
    nameAr: string;
    nameEn: string;
    floor: string | null;
    bedrooms: number;
    bathrooms: number;
    majlis: number;
    halls: number;
    kitchens: number;
    hasPool: boolean;
    areaSquareMeters: string | null;
  } | null;
  propertyRow:
    | (Omit<ContractPremises, 'unit' | 'propertyNameAr' | 'propertyNameEn'> & {
        id: string;
        nameAr: string;
        nameEn: string;
      })
    | null;
  identityDocs: Array<{ partyId: string; documentType: string; last4: string }>;
  location: PropertyLocation | null;
  booking: LeaseBookingAgreement | null;
};

type PartyRow = {
  id: string;
  displayName: string;
  type: string;
  email: string | null;
  phone: string | null;
};

function partyCard(
  row: PartyRow | null,
  docs: Loaded['identityDocs'],
  details: Record<string, unknown>,
  fallback: { email: string | null; phone: string | null },
): ContractPartyCard | null {
  if (!row) return null;
  const masked = (documentType: string) => {
    const doc = docs.find((item) => item.partyId === row.id && item.documentType === documentType);
    return doc ? `•••• ${doc.last4}` : null;
  };
  const company = details.entityType === 'company' || row.type === 'company';
  return {
    name: text(details.nameAr) ?? row.displayName,
    entityType: company ? 'company' : 'person',
    civilId: text(details.civilId) ?? (company ? null : masked('civil_id')),
    passport: text(details.passport) ?? (company ? null : masked('passport')),
    nationality: text(details.nationality),
    crNumber: text(details.crNumber) ?? (company ? masked('commercial_registration') : null),
    signatoryName: text(details.signatoryName),
    signatoryCivilId: text(details.signatoryCivilId),
    phone: text(details.phone) ?? row.phone ?? fallback.phone,
    email: text(details.email) ?? row.email ?? fallback.email,
  };
}

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
  const booking = loaded.booking;
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
    : booking
      ? leaseBookingAgreement(booking).doc.terms
      : [];
  const bookingUrl = booking
    ? `${publicWebOrigin()}${leaseBookingDocumentPath('ar', booking.referenceCode)}`
    : null;

  const esignAt = text(loaded.esign?.signedAt);
  const files: ContractDocument['files'] = loaded.esign
    ? (Object.keys(CONTRACT_FILE_FIELDS) as ContractFileKind[])
        .filter((kind) => kind === 'signature' || loaded.showIdentityFiles)
        .filter((kind) => loaded.esign?.[CONTRACT_FILE_FIELDS[kind]] === true)
        .map((kind) => ({ kind, signedAt: esignAt }))
    : [];

  const approval = record(snapshot.approval);
  const verifyUrl = contractVerifyUrl(contractVerifyToken(contract.id, contract.createdAt));
  const qrSvg = await contractQrSvg(verifyUrl).catch(() => null);
  const checkInStamp = loaded.stamps?.checkIn ?? null;
  const checkOutStamp = loaded.stamps?.checkOut ?? null;
  const recipient = checkInStamp?.recipient ?? null;
  const propertyId = loaded.propertyRow?.id ?? null;
  return {
    type,
    verification: qrSvg ? { url: verifyUrl, qrSvg } : null,
    createdAt: contract.createdAt.toISOString(),
    sentAt: contract.sentAt?.toISOString() ?? null,
    completedAt: contract.completedAt?.toISOString() ?? null,
    template: {
      ar: sanitizeContractHtml(loaded.template.ar),
      en: sanitizeContractHtml(loaded.template.en),
    },
    letterhead: loaded.letterhead,
    amount: money(snapshot.amount),
    deposit,
    stayType: text(snapshot.stayType),
    checkInTime: text(snapshot.checkInTime) ?? loaded.stayPeriodTimes?.checkInTime ?? null,
    checkOutTime: text(snapshot.checkOutTime) ?? loaded.stayPeriodTimes?.checkOutTime ?? null,
    rescheduleChange: (() => {
      if (contract.kind !== 'amendment' && source.type !== 'stay_booking_reschedule') return null;
      const previous = record(snapshot.previous);
      if (!text(previous.startsOn)) return null;
      const approvals = record(snapshot.approvals);
      const guest = record(approvals.guest);
      const ownerApproval = record(approvals.owner);
      const difference = record(snapshot.difference);
      return {
        previous: {
          startsOn: text(previous.startsOn)!,
          endsOn: text(previous.endsOn),
          stayType: text(previous.stayType),
          checkInTime: text(previous.checkInTime),
          checkOutTime: text(previous.checkOutTime),
          amount: money(previous.amount),
        },
        next: {
          startsOn: text(snapshot.startsOn) ?? text(previous.startsOn)!,
          endsOn: text(snapshot.endsOn),
          stayType: text(snapshot.stayType),
          checkInTime: text(snapshot.checkInTime),
          checkOutTime: text(snapshot.checkOutTime),
          amount: money(snapshot.amount),
        },
        difference: Object.keys(difference).length
          ? {
              originalTotalMinor: text(difference.originalTotalMinor),
              quotedTotalMinor: text(difference.quotedTotalMinor),
              chargedTotalMinor: text(difference.chargedTotalMinor),
              forfeitedMinor: text(difference.forfeitedMinor),
              extraDueMinor: text(difference.extraDueMinor),
            }
          : null,
        approvals: {
          guestAt: text(guest.at),
          ownerAt: text(ownerApproval.at),
        },
      };
    })(),
    terminationClose: (() => {
      const term = record(snapshot.termination);
      const sync = record(snapshot.terminationSync);
      const lateObj = record(
        term.lateReturn && typeof term.lateReturn === 'object'
          ? term.lateReturn
          : sync.lateReturn,
      );
      const cancelledAt =
        text(term.cancelledAt) ?? text(sync.cancelledAt) ?? text(sync.at) ?? checkOutStamp?.at;
      if (
        !cancelledAt ||
        (contract.kind !== 'termination' &&
          source.type !== 'stay_booking_checkout' &&
          !Object.keys(sync).length)
      ) {
        return null;
      }
      const lateMinutes = Number(lateObj.lateMinutes);
      return {
        cancelledAt,
        effectiveOn:
          text(term.effectiveOn) ?? text(sync.effectiveOn) ?? cancelledAt.slice(0, 10),
        recordedBy: text(term.recordedBy),
        scheduledCheckOutAt: text(lateObj.scheduledAt),
        actualCheckOutAt: text(lateObj.actualAt) ?? checkOutStamp?.at ?? cancelledAt,
        lateMinutes: Number.isFinite(lateMinutes) ? lateMinutes : 0,
        lateLabelAr: text(lateObj.labelAr) ?? 'بدون تأخير عن موعد المغادرة',
        lateLabelEn: text(lateObj.labelEn) ?? 'No delay past scheduled check-out',
      };
    })(),
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
    owner: partyCard(loaded.owner, loaded.identityDocs, {}, { email: null, phone: null }),
    tenant: partyCard(loaded.tenant, loaded.identityDocs, record(snapshot.tenantDetails), {
      email: text(guestContact.email) ?? stay?.guestEmail ?? null,
      phone: text(guestContact.phone) ?? stay?.guestPhone ?? null,
    }),
    premises: loaded.propertyRow
      ? (() => {
          const { nameAr, nameEn, ...rest } = loaded.propertyRow;
          return {
            ...rest,
            propertyNameAr: nameAr,
            propertyNameEn: nameEn,
            unit: loaded.unit
              ? {
                  code: loaded.unit.code,
                  nameAr: loaded.unit.nameAr,
                  nameEn: loaded.unit.nameEn,
                  floor: loaded.unit.floor,
                  bedrooms: loaded.unit.bedrooms,
                  bathrooms: loaded.unit.bathrooms,
                  majlis: loaded.unit.majlis,
                  halls: loaded.unit.halls,
                  kitchens: loaded.unit.kitchens,
                  hasPool: loaded.unit.hasPool,
                  areaSquareMeters: loaded.unit.areaSquareMeters,
                }
              : null,
          };
        })()
      : null,
    location: loaded.location,
    terms,
    termsAcceptedAt: text(accepted.acceptedAt) ?? booking?.termsAcceptedAt ?? null,
    booking:
      booking && bookingUrl
        ? {
            referenceCode: booking.referenceCode,
            url: bookingUrl,
            qrSvg: await contractQrSvg(bookingUrl).catch(() => null),
            termsAcceptedAt: booking.termsAcceptedAt ?? null,
            signedAt: booking.signature?.signedAt ?? null,
          }
        : null,
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
        serial: loaded.serials.get(row.id) ?? null,
      };
    }),
    files,
    stay: stay
      ? {
          status: stay.status,
          nights: stay.nights ?? null,
          adults: stay.adults ?? null,
          children: stay.children ?? null,
          checkIn: checkInStamp
            ? {
                at: checkInStamp.at,
                notes: checkInStamp.notes,
                noteKeys: checkInStamp.noteKeys,
                customNote: checkInStamp.customNote,
                important: checkInStamp.important,
              }
            : null,
          checkOut: checkOutStamp
            ? {
                at: checkOutStamp.at,
                notes: checkOutStamp.notes,
                noteKeys: checkOutStamp.noteKeys,
                customNote: checkOutStamp.customNote,
                important: checkOutStamp.important,
              }
            : null,
          recipient: recipient
            ? {
                name: recipient.name,
                phone: recipient.phone,
                documentKind: recipient.documentKind,
                documentHref:
                  recipient.hasDocument && loaded.canManageStays && propertyId
                    ? `/api/owner/properties/${propertyId}/records/handover/${stay.id}`
                    : null,
              }
            : null,
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
    annexes: loaded.stayBookingId
      ? contractAnnexLinks(contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`, {
          checkIn: checkInStamp?.at ?? null,
          checkOut: checkOutStamp?.at ?? null,
          depositRefund: loaded.refundRequestedAt,
        })
      : booking
        ? leaseAnnexLinks(
            contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`,
            booking.lifecycle.handover?.at ?? null,
          )
        : [],
  };
}
