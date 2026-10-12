import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  contractSignatures,
  contracts,
  createDatabase,
  leases,
  parties,
  partyIdentityDocuments,
  properties,
  units,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readTermsLetterhead } from '@/lib/booking-terms-neon';
import { contractIdFromToken, contractVerifyToken, signatureSerials } from '@/lib/contract-verify';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRContractVerifyDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRContractVerifyDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRContractVerifyDb = { db };
  }
  return globalForDb.__bhdRContractVerifyDb;
}

/** A party as shown publicly: name plus masked identifiers, never full numbers. */
export type VerifiedParty = {
  name: string;
  entityType: 'person' | 'company';
  idMasked: string | null;
  idKind: 'civil_id' | 'passport' | 'commercial_registration' | null;
  nationality: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
};

export type ContractVerification = {
  reference: string;
  type: 'stay' | 'lease' | 'sale';
  kind: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  issuer: { nameAr: string; nameEn: string; logoDataUrl: string | null };
  property: { nameAr: string; nameEn: string } | null;
  unit: { code: string; nameAr: string; nameEn: string } | null;
  landlord: VerifiedParty | null;
  tenant: VerifiedParty | null;
  signatures: Array<{
    role: 'owner' | 'tenant';
    name: string | null;
    signedAt: string;
    serial: string | null;
  }>;
  /** Serial of the signature that completed the contract. */
  serial: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Last four characters only; stored identity documents already keep just those. */
function maskTail(value: string | null): string | null {
  const clean = value?.replace(/[\s•]+/g, '') ?? '';
  if (!clean) return null;
  return `•••• ${clean.slice(-4)}`;
}

function maskPhone(value: string | null): string | null {
  const digits = value?.replace(/[^\d+]/g, '') ?? '';
  if (digits.replace(/\D/g, '').length < 6) return null;
  const plus = digits.startsWith('+');
  const body = digits.replace(/\D/g, '');
  const head = plus ? `+${body.slice(0, 3)}` : body.slice(0, 2);
  return `${head} •••• ${body.slice(-3)}`;
}

function maskEmail(value: string | null): string | null {
  const match = value?.trim().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!match) return null;
  const [, local, domain] = match;
  return `${local!.slice(0, 1)}•••@${domain}`;
}

/**
 * Public verification of a contract from its QR token: who the parties are, that it is
 * approved, and the e-signature serials. Terms, amounts and documents are never returned.
 */
export async function loadContractVerification(
  token: string,
): Promise<ContractVerification | null> {
  if (!hasDatabaseUrl()) return null;
  const contractId = contractIdFromToken(token);
  if (!contractId) return null;
  const { db } = getDatabase();

  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const [contract] = await tx
      .select()
      .from(contracts)
      .where(eq(contracts.id, contractId))
      .limit(1);
    if (!contract || contractVerifyToken(contract.id, contract.createdAt) !== token.toLowerCase()) {
      return null;
    }
    const orgId = contract.organizationId;
    const linkedContractId =
      contract.kind === 'renewal' && contract.parentContractId
        ? contract.parentContractId
        : contract.id;

    const [partyRows, identityDocs, unit, signatures, lease, letterhead] = await Promise.all([
      tx
        .select({
          id: parties.id,
          displayName: parties.displayName,
          type: parties.type,
          email: parties.email,
          phone: parties.phone,
        })
        .from(parties)
        .where(
          and(
            eq(parties.organizationId, orgId),
            inArray(parties.id, [contract.ownerPartyId, contract.tenantPartyId]),
          ),
        ),
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
      tx
        .select({
          code: units.code,
          nameAr: units.nameAr,
          nameEn: units.nameEn,
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
        })
        .from(units)
        .innerJoin(
          properties,
          and(eq(properties.id, units.propertyId), eq(properties.organizationId, orgId)),
        )
        .where(and(eq(units.organizationId, orgId), eq(units.id, contract.unitId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select({
          id: contractSignatures.id,
          signerRole: contractSignatures.signerRole,
          evidence: contractSignatures.evidence,
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
        .select({ startsOn: leases.startsOn, endsOn: leases.endsOn })
        .from(leases)
        .where(and(eq(leases.organizationId, orgId), eq(leases.contractId, linkedContractId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      readTermsLetterhead(tx, orgId).catch(() => null),
    ]);
    const serials = await signatureSerials(tx, orgId, contract.id);

    const snapshot = record(contract.payloadSnapshot);
    const contractInfo = record(snapshot.contract);
    const source = record(snapshot.source);
    const type: ContractVerification['type'] =
      contractInfo.type === 'sale'
        ? 'sale'
        : source.type === 'stay_booking' || snapshot.stayType
          ? 'stay'
          : 'lease';

    const verifiedParty = (
      partyId: string,
      details: Record<string, unknown>,
    ): VerifiedParty | null => {
      const row = partyRows.find((item) => item.id === partyId);
      if (!row) return null;
      const company = details.entityType === 'company' || row.type === 'company';
      const doc = (documentType: string) =>
        identityDocs.find((item) => item.partyId === partyId && item.documentType === documentType);
      const civil = text(details.civilId) ?? (doc('civil_id') ? doc('civil_id')!.last4 : null);
      const passport = text(details.passport) ?? (doc('passport') ? doc('passport')!.last4 : null);
      const cr =
        text(details.crNumber) ??
        (doc('commercial_registration') ? doc('commercial_registration')!.last4 : null);
      const [idKind, idValue]: [VerifiedParty['idKind'], string | null] = company
        ? ['commercial_registration', cr]
        : civil
          ? ['civil_id', civil]
          : passport
            ? ['passport', passport]
            : [null, null];
      return {
        name: text(details.nameAr) ?? row.displayName,
        entityType: company ? 'company' : 'person',
        idKind: idValue ? idKind : null,
        idMasked: maskTail(idValue),
        nationality: text(details.nationality),
        phoneMasked: maskPhone(text(details.phone) ?? row.phone),
        emailMasked: maskEmail(text(details.email) ?? row.email),
      };
    };

    const tenantDetails = record(snapshot.tenantDetails);
    const guestContact = record(
      record(signatures.find((row) => row.signerRole !== 'owner')?.evidence).guestContact,
    );
    const tenant = verifiedParty(contract.tenantPartyId, {
      ...tenantDetails,
      phone: text(tenantDetails.phone) ?? text(guestContact.phone),
      email: text(tenantDetails.email) ?? text(guestContact.email),
    });
    const landlord = verifiedParty(contract.ownerPartyId, {});

    const signed = signatures.map((row) => {
      const evidence = record(row.evidence);
      const role = row.signerRole === 'owner' ? ('owner' as const) : ('tenant' as const);
      return {
        role,
        name:
          text(evidence.signedByName) ??
          text(record(evidence.guestContact).displayName) ??
          (role === 'owner' ? (landlord?.name ?? null) : (tenant?.name ?? null)),
        signedAt: row.signedAt.toISOString(),
        serial: serials.get(row.id) ?? null,
      };
    });

    return {
      reference: contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`,
      type,
      kind: contract.kind,
      status: contract.status,
      createdAt: contract.createdAt.toISOString(),
      completedAt: contract.completedAt?.toISOString() ?? null,
      startsOn: text(snapshot.startsOn) ?? lease?.startsOn ?? null,
      endsOn: text(snapshot.endsOn) ?? lease?.endsOn ?? null,
      issuer: {
        nameAr: letterhead?.nameAr || landlord?.name || 'BHD R',
        nameEn: letterhead?.nameEn || landlord?.name || 'BHD R',
        logoDataUrl: letterhead?.logoDataUrl ?? null,
      },
      property: unit ? { nameAr: unit.propertyNameAr, nameEn: unit.propertyNameEn } : null,
      unit: unit ? { code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn } : null,
      landlord,
      tenant,
      signatures: signed,
      serial: signed.filter((row) => row.serial).at(-1)?.serial ?? null,
    };
  });
}
