import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { hasPermission } from '@bhd-r/authz';
import {
  approvalRequests,
  contractSignatures,
  contracts,
  leases,
  parties,
  properties,
  units,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { ownerPartyScope, readClaims, withinViewerTenant } from '@/lib/portal-ops-data';

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

/**
 * Contract detail straight from Neon, matching `GET /v1/leasing/contracts/:id`.
 * Returns null when it cannot answer (no DB, no permission, not visible to this
 * party) so the caller can fall back to Nest.
 */
export async function loadContractDetailFromNeon(
  contractId: string,
  portal: 'owner' | 'tenant' | 'developer',
): Promise<ContractDetail | null> {
  if (!hasDatabaseUrl() || !UUID.test(contractId)) return null;
  const claims = await readClaims();
  if (!claims?.organizationId || !hasPermission(claims, 'contract.read')) return null;
  const orgId = claims.organizationId;
  const partyScope = portal === 'tenant' ? claims.partyId : ownerPartyScope(claims);
  if (portal === 'tenant' && !partyScope) return null;

  const detail = await withinViewerTenant(claims, async (tx) => {
    const [contract] = await tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.organizationId, orgId)))
      .limit(1);
    if (!contract) return null;
    if (partyScope && ![contract.ownerPartyId, contract.tenantPartyId].includes(partyScope)) {
      return null;
    }

    const linkedContractId = contract.kind === 'renewal' ? contract.parentContractId : contract.id;
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
          signatureHash: contractSignatures.signatureHash,
          signedAt: contractSignatures.signedAt,
        })
        .from(contractSignatures)
        .where(
          and(
            eq(contractSignatures.organizationId, orgId),
            eq(contractSignatures.contractId, contract.id),
          ),
        ),
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
    return { contract, lease, owner, tenant, unit, property, signatures, approval };
  });
  if (!detail) return null;

  const { contract, lease, owner, tenant, unit, property, signatures, approval } = detail;
  const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
  const reference = contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`;
  const signerPartyId = claims.partyId;
  return {
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
