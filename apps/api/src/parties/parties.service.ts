import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  leases,
  parties,
  partyAddresses,
  partyIdentityDocuments,
  partyRoles,
  properties,
  representationAuthorities,
} from '@bhd-r/db';
import { decryptField, encryptField, type Keyring } from '@bhd-r/security';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';

export type PartyRoleKey =
  | 'prospect'
  | 'tenant'
  | 'owner'
  | 'supplier'
  | 'partner'
  | 'government'
  | 'authorized_representative'
  | 'lawyer'
  | 'other';

export interface PartyAddressInput {
  label?: string | undefined;
  primary?: boolean | undefined;
  countryCode?: string | undefined;
  governorate: string;
  wilayat: string;
  city: string;
  area?: string | undefined;
  street?: string | undefined;
  buildingNumber?: string | undefined;
  postalCode?: string | undefined;
}

export interface IdentityDocumentInput {
  documentType: 'civil_id' | 'passport' | 'commercial_registration' | 'tax_card' | 'other';
  number: string;
  issuingCountryCode?: string | undefined;
  issuedOn?: string | undefined;
  expiresOn?: string | undefined;
}

export interface CreatePartyInput {
  type: 'person' | 'company';
  displayName: string;
  email?: string | undefined;
  phone?: string | undefined;
  roles: PartyRoleKey[];
  profile?: Record<string, string | string[] | null> | undefined;
  address?: PartyAddressInput | undefined;
  identityDocuments?: IdentityDocumentInput[] | undefined;
}

function fieldKeyring(purpose: string): Keyring {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && value,
  );
  if (entries.length === 0) {
    entries.push(['FIELD_ENCRYPTION_KEY_V1', 'development-field-key-change-in-production']);
  }
  return {
    activeVersion: process.env.FIELD_ENCRYPTION_ACTIVE_VERSION ?? 'v1',
    keys: Object.fromEntries(
      entries.map(([name, value]) => [
        name.replace('FIELD_ENCRYPTION_KEY_', '').toLowerCase(),
        createHash('sha256')
          .update(`${value ?? ''}\0${purpose}`)
          .digest(),
      ]),
    ),
  };
}

function normalizeIdentity(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

function lookupHash(organizationId: string, kind: string, value: string): string {
  return createHmac(
    'sha256',
    process.env.PII_LOOKUP_PEPPER ??
      process.env.BHD_R_SESSION_SECRET ??
      'development-pii-lookup-pepper',
  )
    .update(`${organizationId}\0${kind}\0${normalizeIdentity(value)}`)
    .digest('hex');
}

function normalizedEmail(value: string | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

@Injectable()
export class PartiesService {
  constructor(private readonly database: DatabaseService) {}

  list(
    claims: SessionClaims,
    input: {
      role?: PartyRoleKey | undefined;
      query?: string | undefined;
      includeArchived?: boolean;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const query = input.query?.trim();
      const conditions = [eq(parties.organizationId, claims.organizationId!)];
      if (!input.includeArchived) conditions.push(eq(parties.status, 'active'));
      if (query) {
        conditions.push(
          or(
            ilike(parties.displayName, `%${query}%`),
            ilike(parties.email, `%${query}%`),
            ilike(parties.phone, `%${query}%`),
          )!,
        );
      }
      const rows = input.role
        ? await transaction
            .selectDistinct({ party: parties })
            .from(parties)
            .innerJoin(
              partyRoles,
              and(
                eq(partyRoles.partyId, parties.id),
                eq(partyRoles.organizationId, claims.organizationId!),
                eq(partyRoles.roleKey, input.role),
                eq(partyRoles.status, 'active'),
              ),
            )
            .where(and(...conditions))
            .orderBy(asc(parties.displayName))
        : await transaction
            .select({ party: parties })
            .from(parties)
            .where(and(...conditions))
            .orderBy(asc(parties.displayName));
      return this.hydrate(
        transaction,
        rows.map((row) => row.party),
        false,
      );
    });
  }

  async get(claims: SessionClaims, id: string, includeSensitive: boolean) {
    return this.database.withinTenant(claims, async (transaction) => {
      const party = await transaction.query.parties.findFirst({
        where: and(eq(parties.id, id), eq(parties.organizationId, claims.organizationId!)),
      });
      if (!party) throw new NotFoundException('Party not found');
      return (await this.hydrate(transaction, [party], includeSensitive))[0]!;
    });
  }

  create(claims: SessionClaims, input: CreatePartyInput) {
    return this.database.withinTenant(claims, async (transaction) => {
      const organizationId = claims.organizationId!;
      const email = normalizedEmail(input.email);
      if (email) {
        const duplicate = await transaction.query.parties.findFirst({
          where: and(eq(parties.organizationId, organizationId), eq(parties.email, email)),
        });
        if (duplicate) throw new ConflictException('A party with this email already exists');
      }

      const partyId = randomUUID();
      const identityDocuments = input.identityDocuments ?? [];
      const civilId = identityDocuments.find((document) => document.documentType === 'civil_id');
      const registration = identityDocuments.find(
        (document) => document.documentType === 'commercial_registration',
      );
      const partyRows = await transaction
        .insert(parties)
        .values({
          id: partyId,
          organizationId,
          type: input.type,
          displayName: input.displayName.trim(),
          email,
          phone: input.phone?.trim() || null,
          ...(civilId
            ? {
                nationalIdEncrypted: encryptField(
                  normalizeIdentity(civilId.number),
                  fieldKeyring('party-identity'),
                  `party:${organizationId}:${partyId}:national_id`,
                ),
                nationalIdLookupHash: lookupHash(organizationId, 'civil_id', civilId.number),
              }
            : {}),
          ...(registration
            ? {
                registrationNumberEncrypted: encryptField(
                  normalizeIdentity(registration.number),
                  fieldKeyring('party-identity'),
                  `party:${organizationId}:${partyId}:registration_number`,
                ),
                registrationNumberLookupHash: lookupHash(
                  organizationId,
                  'commercial_registration',
                  registration.number,
                ),
              }
            : {}),
          metadata: { profile: input.profile ?? {} },
        })
        .returning();
      await this.replaceRoles(transaction, organizationId, partyId, input.roles);
      if (input.address) {
        await this.insertAddress(transaction, organizationId, partyId, input.address);
      }
      if (identityDocuments.length) {
        await this.insertIdentityDocuments(transaction, organizationId, partyId, identityDocuments);
      }
      return (await this.hydrate(transaction, [partyRows[0]!], false))[0]!;
    });
  }

  update(
    claims: SessionClaims,
    id: string,
    input: {
      displayName?: string | undefined;
      email?: string | null | undefined;
      phone?: string | null | undefined;
      roles?: PartyRoleKey[] | undefined;
      profile?: Record<string, string | string[] | null> | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.parties.findFirst({
        where: and(eq(parties.id, id), eq(parties.organizationId, claims.organizationId!)),
      });
      if (!current) throw new NotFoundException('Party not found');
      const nextMetadata = input.profile
        ? {
            ...(typeof current.metadata === 'object' && current.metadata !== null
              ? current.metadata
              : {}),
            profile: input.profile,
          }
        : current.metadata;
      const rows = await transaction
        .update(parties)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
          ...(input.email !== undefined
            ? { email: normalizedEmail(input.email ?? undefined) }
            : {}),
          ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
          metadata: nextMetadata,
          updatedAt: new Date(),
        })
        .where(and(eq(parties.id, id), eq(parties.organizationId, claims.organizationId!)))
        .returning();
      if (input.roles) {
        await this.replaceRoles(transaction, claims.organizationId!, id, input.roles);
      }
      return (await this.hydrate(transaction, [rows[0]!], false))[0]!;
    });
  }

  addAddress(claims: SessionClaims, partyId: string, input: PartyAddressInput) {
    return this.database.withinTenant(claims, async (transaction) => {
      await this.assertParty(transaction, claims.organizationId!, partyId);
      return this.insertAddress(transaction, claims.organizationId!, partyId, input);
    });
  }

  addIdentityDocument(claims: SessionClaims, partyId: string, input: IdentityDocumentInput) {
    return this.database.withinTenant(claims, async (transaction) => {
      await this.assertParty(transaction, claims.organizationId!, partyId);
      const rows = await this.insertIdentityDocuments(
        transaction,
        claims.organizationId!,
        partyId,
        [input],
      );
      return rows[0];
    });
  }

  addRepresentative(
    claims: SessionClaims,
    principalPartyId: string,
    input: {
      representativePartyId: string;
      title: string;
      scopes: string[];
      startsOn?: string | undefined;
      endsOn?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const [principal, representative] = await Promise.all([
        this.assertParty(transaction, claims.organizationId!, principalPartyId),
        this.assertParty(transaction, claims.organizationId!, input.representativePartyId),
      ]);
      if (principal.type !== 'company') {
        throw new ConflictException('Only a company can appoint a representative in this flow');
      }
      const rows = await transaction
        .insert(representationAuthorities)
        .values({
          organizationId: claims.organizationId!,
          principalPartyId,
          representativePartyId: representative.id,
          title: input.title,
          scopes: input.scopes,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
        })
        .returning();
      await transaction
        .insert(partyRoles)
        .values({
          organizationId: claims.organizationId!,
          partyId: representative.id,
          roleKey: 'authorized_representative',
        })
        .onConflictDoUpdate({
          target: [partyRoles.organizationId, partyRoles.partyId, partyRoles.roleKey],
          set: { status: 'active', updatedAt: new Date() },
        });
      return rows[0];
    });
  }

  archive(claims: SessionClaims, id: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const [activeLease, ownedProperty] = await Promise.all([
        transaction.query.leases.findFirst({
          where: and(
            eq(leases.organizationId, claims.organizationId!),
            or(eq(leases.tenantPartyId, id), eq(leases.ownerPartyId, id)),
            inArray(leases.status, ['draft', 'active']),
          ),
        }),
        transaction.query.properties.findFirst({
          where: and(
            eq(properties.organizationId, claims.organizationId!),
            eq(properties.ownerPartyId, id),
            inArray(properties.status, ['draft', 'active']),
          ),
        }),
      ]);
      if (activeLease || ownedProperty) {
        throw new ConflictException('Party has an active property or lease relationship');
      }
      const rows = await transaction
        .update(parties)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(parties.id, id), eq(parties.organizationId, claims.organizationId!)))
        .returning();
      if (!rows[0]) throw new NotFoundException('Party not found');
      return rows[0];
    });
  }

  private async hydrate(
    transaction: DatabaseTransaction,
    partyRows: Array<typeof parties.$inferSelect>,
    includeSensitive: boolean,
  ) {
    const ids = partyRows.map((party) => party.id);
    if (ids.length === 0) return [];
    const [roles, addressRows, documents, representatives] = await Promise.all([
      transaction
        .select({ partyId: partyRoles.partyId, roleKey: partyRoles.roleKey })
        .from(partyRoles)
        .where(and(inArray(partyRoles.partyId, ids), eq(partyRoles.status, 'active'))),
      transaction
        .select({
          partyId: partyAddresses.partyId,
          label: partyAddresses.label,
          primary: partyAddresses.primary,
          address: addresses,
        })
        .from(partyAddresses)
        .innerJoin(addresses, eq(addresses.id, partyAddresses.addressId))
        .where(inArray(partyAddresses.partyId, ids)),
      transaction
        .select()
        .from(partyIdentityDocuments)
        .where(inArray(partyIdentityDocuments.partyId, ids)),
      transaction
        .select({
          id: representationAuthorities.id,
          principalPartyId: representationAuthorities.principalPartyId,
          representativePartyId: representationAuthorities.representativePartyId,
          title: representationAuthorities.title,
          scopes: representationAuthorities.scopes,
          startsOn: representationAuthorities.startsOn,
          endsOn: representationAuthorities.endsOn,
          status: representationAuthorities.status,
        })
        .from(representationAuthorities)
        .where(
          or(
            inArray(representationAuthorities.principalPartyId, ids),
            inArray(representationAuthorities.representativePartyId, ids),
          ),
        ),
    ]);
    const keyring = includeSensitive ? fieldKeyring('party-document') : null;
    return partyRows.map((party) => ({
      id: party.id,
      type: party.type,
      displayName: party.displayName,
      email: party.email,
      phone: party.phone,
      status: party.status,
      profile:
        typeof party.metadata === 'object' && party.metadata !== null && 'profile' in party.metadata
          ? (party.metadata as Record<string, unknown>).profile
          : {},
      roles: roles.filter((role) => role.partyId === party.id).map((role) => role.roleKey),
      addresses: addressRows
        .filter((row) => row.partyId === party.id)
        .map((row) => ({ label: row.label, primary: row.primary, address: row.address })),
      identityDocuments: documents
        .filter((document) => document.partyId === party.id)
        .map((document) => ({
          id: document.id,
          documentType: document.documentType,
          number: includeSensitive
            ? decryptField(
                document.numberEncrypted,
                keyring!,
                `party-document:${party.organizationId}:${document.id}`,
              )
            : `••••${document.numberLast4}`,
          issuingCountryCode: document.issuingCountryCode,
          issuedOn: document.issuedOn,
          expiresOn: document.expiresOn,
          verificationStatus: document.verificationStatus,
        })),
      representations: representatives.filter(
        (row) => row.principalPartyId === party.id || row.representativePartyId === party.id,
      ),
      createdAt: party.createdAt,
      updatedAt: party.updatedAt,
    }));
  }

  private async assertParty(transaction: DatabaseTransaction, organizationId: string, id: string) {
    const party = await transaction.query.parties.findFirst({
      where: and(eq(parties.id, id), eq(parties.organizationId, organizationId)),
    });
    if (!party) throw new NotFoundException('Party not found');
    return party;
  }

  private async replaceRoles(
    transaction: DatabaseTransaction,
    organizationId: string,
    partyId: string,
    roles: PartyRoleKey[],
  ) {
    await transaction
      .update(partyRoles)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(and(eq(partyRoles.organizationId, organizationId), eq(partyRoles.partyId, partyId)));
    for (const roleKey of [...new Set(roles)]) {
      await transaction
        .insert(partyRoles)
        .values({ organizationId, partyId, roleKey })
        .onConflictDoUpdate({
          target: [partyRoles.organizationId, partyRoles.partyId, partyRoles.roleKey],
          set: { status: 'active', updatedAt: new Date() },
        });
    }
  }

  private async insertAddress(
    transaction: DatabaseTransaction,
    organizationId: string,
    partyId: string,
    input: PartyAddressInput,
  ) {
    if (input.primary) {
      await transaction
        .update(partyAddresses)
        .set({ primary: false })
        .where(
          and(
            eq(partyAddresses.organizationId, organizationId),
            eq(partyAddresses.partyId, partyId),
          ),
        );
    }
    const rows = await transaction
      .insert(addresses)
      .values({
        organizationId,
        countryCode: input.countryCode ?? 'OM',
        governorate: input.governorate,
        wilayat: input.wilayat,
        city: input.city,
        area: input.area,
        street: input.street,
        buildingNumber: input.buildingNumber,
        postalCode: input.postalCode,
      })
      .returning();
    await transaction.insert(partyAddresses).values({
      organizationId,
      partyId,
      addressId: rows[0]!.id,
      label: input.label ?? 'primary',
      primary: input.primary ?? true,
    });
    return rows[0]!;
  }

  private async insertIdentityDocuments(
    transaction: DatabaseTransaction,
    organizationId: string,
    partyId: string,
    inputs: IdentityDocumentInput[],
  ) {
    const values = inputs.map((input) => {
      const id = randomUUID();
      const normalized = normalizeIdentity(input.number);
      return {
        id,
        organizationId,
        partyId,
        documentType: input.documentType,
        numberEncrypted: encryptField(
          normalized,
          fieldKeyring('party-document'),
          `party-document:${organizationId}:${id}`,
        ),
        numberLookupHash: lookupHash(organizationId, input.documentType, normalized),
        numberLast4: normalized.slice(-4).padStart(4, '•'),
        issuingCountryCode: input.issuingCountryCode ?? 'OM',
        issuedOn: input.issuedOn,
        expiresOn: input.expiresOn,
      };
    });
    return transaction.insert(partyIdentityDocuments).values(values).returning({
      id: partyIdentityDocuments.id,
      documentType: partyIdentityDocuments.documentType,
      number: partyIdentityDocuments.numberLast4,
      expiresOn: partyIdentityDocuments.expiresOn,
      verificationStatus: partyIdentityDocuments.verificationStatus,
    });
  }
}
