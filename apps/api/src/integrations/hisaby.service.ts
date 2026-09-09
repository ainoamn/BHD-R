import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Permission, SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  expenses,
  hisabyLinks,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  leases,
  organizations,
  parties,
  partyAddresses,
  partyRoles,
  payments,
  properties,
  propertyProfiles,
  receipts,
  stayBookingGuests,
  stayBookings,
  units,
} from '@bhd-r/db';
import { assertSafeOutboundUrl, decryptField, encryptField, type Keyring } from '@bhd-r/security';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';

async function assertHisabyEventsUrl(eventsUrl: string): Promise<void> {
  await assertSafeOutboundUrl(
    eventsUrl,
    async (hostname) =>
      (await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address),
    ['hisaby.bhd-om.com'],
  );
}

function secretKeyring(purpose: string): Keyring {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && value,
  );
  if (entries.length === 0)
    entries.push(['FIELD_ENCRYPTION_KEY_V1', 'development-field-key-change-in-production']);
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

function hasPermission(claims: SessionClaims, permission: Permission): boolean {
  return claims.permissions.includes(permission);
}

function serializeMoney(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function ensureHisabyLinksTable(transaction: DatabaseTransaction): Promise<void> {
  await transaction.execute(sql`
    CREATE TABLE IF NOT EXISTS hisaby_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      organization_id uuid NOT NULL REFERENCES organizations (id),
      hisaby_company_id varchar(80),
      events_url text NOT NULL,
      inbound_token_encrypted text NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'active',
      last_sync_at timestamptz,
      last_sync_status varchar(40),
      last_sync_error text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await transaction.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS hisaby_links_org_unique ON hisaby_links (organization_id)
  `);
  await transaction.execute(sql`ALTER TABLE hisaby_links ENABLE ROW LEVEL SECURITY`);
  await transaction.execute(sql`ALTER TABLE hisaby_links FORCE ROW LEVEL SECURITY`);
  await transaction.execute(sql`DROP POLICY IF EXISTS tenant_isolation ON hisaby_links`);
  await transaction.execute(sql`
    CREATE POLICY tenant_isolation ON hisaby_links
    USING (
      app_private.is_platform_admin()
      OR organization_id = app_private.current_organization_id()
      OR app_private.is_worker()
    )
    WITH CHECK (
      app_private.is_platform_admin()
      OR organization_id = app_private.current_organization_id()
    )
  `);
}

@Injectable()
export class HisabyService {
  constructor(private readonly database: DatabaseService) {}

  getConnection(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      await ensureHisabyLinksTable(transaction);
      const row = await transaction.query.hisabyLinks.findFirst({
        where: eq(hisabyLinks.organizationId, claims.organizationId!),
      });
      if (!row) {
        return {
          linked: false,
          status: 'missing' as const,
          eventsUrl: null,
          hisabyCompanyId: null,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastSyncError: null,
          exportPath: '/v1/integrations/hisaby/export',
          syncMode: 'push_and_pull',
        };
      }
      return {
        linked: row.status === 'active',
        status: row.status,
        eventsUrl: row.eventsUrl,
        hisabyCompanyId: row.hisabyCompanyId,
        lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: row.lastSyncStatus,
        lastSyncError: row.lastSyncError,
        exportPath: '/v1/integrations/hisaby/export',
        syncMode: 'push_and_pull',
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  upsertConnection(
    claims: SessionClaims,
    input: {
      eventsUrl: string;
      inboundToken: string;
      hisabyCompanyId?: string | undefined;
      status?: 'active' | 'paused' | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      await ensureHisabyLinksTable(transaction);
      const eventsUrl = input.eventsUrl.trim();
      try {
        await assertHisabyEventsUrl(eventsUrl);
      } catch {
        throw new BadRequestException('Hisaby events URL is not a safe public HTTPS endpoint');
      }
      const token = input.inboundToken.trim();
      if (token.length < 16 || token.length > 500) {
        throw new BadRequestException('Inbound token must be between 16 and 500 characters');
      }
      const encrypted = encryptField(
        token,
        secretKeyring('hisaby-inbound'),
        `hisaby:${claims.organizationId}`,
      );
      const status = input.status ?? 'active';
      const existing = await transaction.query.hisabyLinks.findFirst({
        where: eq(hisabyLinks.organizationId, claims.organizationId!),
      });
      if (existing) {
        const [updated] = await transaction
          .update(hisabyLinks)
          .set({
            eventsUrl,
            inboundTokenEncrypted: encrypted,
            hisabyCompanyId: input.hisabyCompanyId?.trim() || null,
            status,
            lastSyncError: null,
            updatedAt: new Date(),
          })
          .where(eq(hisabyLinks.id, existing.id))
          .returning();
        return this.publicConnection(updated!);
      }
      const [created] = await transaction
        .insert(hisabyLinks)
        .values({
          organizationId: claims.organizationId!,
          eventsUrl,
          inboundTokenEncrypted: encrypted,
          hisabyCompanyId: input.hisabyCompanyId?.trim() || null,
          status,
        })
        .returning();
      return this.publicConnection(created!);
    });
  }

  async testConnection(claims: SessionClaims) {
    const connection = await this.database.withinTenant(claims, async (transaction) => {
      await ensureHisabyLinksTable(transaction);
      return transaction.query.hisabyLinks.findFirst({
        where: and(
          eq(hisabyLinks.organizationId, claims.organizationId!),
          eq(hisabyLinks.status, 'active'),
        ),
      });
    });
    if (!connection) throw new NotFoundException('Hisaby link is not configured');

    const token = decryptField(
      connection.inboundTokenEncrypted,
      secretKeyring('hisaby-inbound'),
      `hisaby:${claims.organizationId}`,
    );
    const body = {
      idempotencyKey: `bhd-r-ping:${claims.organizationId}:${Date.now()}`,
      type: 'bhd-r.connection.ping',
      occurredOn: new Date().toISOString(),
      organizationExternalId: claims.organizationId,
      hisabyCompanyId: connection.hisabyCompanyId,
      source: 'bhd-r',
      memo: 'Connection test from BHD R',
    };

    let response: Response;
    try {
      await assertHisabyEventsUrl(connection.eventsUrl);
      response = await fetch(connection.eventsUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-bhd-r-source': 'connection-test',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      await this.markSync(claims.organizationId!, 'failed', error instanceof Error ? error.message : 'fetch_failed');
      throw new ServiceUnavailableException('Could not reach Hisaby events endpoint');
    }

    if (!response.ok) {
      const detail = `HTTP ${response.status}`;
      await this.markSync(claims.organizationId!, 'failed', detail);
      throw new ServiceUnavailableException(`Hisaby rejected the test event (${detail})`);
    }
    await this.markSync(claims.organizationId!, 'ok', null);
    return { ok: true, status: response.status };
  }

  exportSnapshot(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const organizationId = claims.organizationId!;
      const org = await transaction.query.organizations.findFirst({
        where: eq(organizations.id, organizationId),
      });
      if (!org) throw new NotFoundException('Organization not found');

      const snapshot: Record<string, unknown> = {
        source: 'bhd-r',
        generatedAt: new Date().toISOString(),
        organization: {
          id: org.id,
          slug: org.slug,
          legalName: org.legalName,
          displayNameAr: org.displayNameAr,
          displayNameEn: org.displayNameEn,
          countryCode: org.countryCode,
          defaultCurrency: org.defaultCurrency,
          type: org.type,
          status: org.status,
        },
        permissionsUsed: claims.permissions.filter((permission) =>
          [
            'organization.read',
            'party.read',
            'party.sensitive.read',
            'property.read',
            'unit.read',
            'lease.read',
            'invoice.read',
            'payment.read',
            'receipt.read',
            'accounting.read',
            'stay.booking.read',
          ].includes(permission),
        ),
      };

      if (hasPermission(claims, 'property.read') || hasPermission(claims, 'unit.read')) {
        const propertyRows = hasPermission(claims, 'property.read')
          ? await transaction
              .select()
              .from(properties)
              .where(eq(properties.organizationId, organizationId))
              .orderBy(asc(properties.createdAt))
          : [];
        const addressIds = [
          ...new Set(propertyRows.map((row) => row.addressId).filter(Boolean)),
        ] as string[];
        const addressRows =
          addressIds.length > 0
            ? await transaction.select().from(addresses).where(inArray(addresses.id, addressIds))
            : [];
        const addressById = new Map(addressRows.map((row) => [row.id, row]));
        const unitRows = hasPermission(claims, 'unit.read')
          ? await transaction
              .select()
              .from(units)
              .where(eq(units.organizationId, organizationId))
              .orderBy(asc(units.createdAt))
          : [];
        const profiles =
          propertyRows.length > 0
            ? await transaction
                .select()
                .from(propertyProfiles)
                .where(
                  inArray(
                    propertyProfiles.propertyId,
                    propertyRows.map((row) => row.id),
                  ),
                )
            : [];
        const profileByProperty = new Map(profiles.map((row) => [row.propertyId, row]));

        snapshot.properties = propertyRows.map((property) => {
          const address = property.addressId ? addressById.get(property.addressId) : undefined;
          const profile = profileByProperty.get(property.id);
          return {
            id: property.id,
            serialNumber: property.serialNumber,
            nameAr: property.nameAr,
            nameEn: property.nameEn,
            kind: property.kind,
            category: property.category,
            status: property.status,
            ownerPartyId: property.ownerPartyId,
            address: address
              ? {
                  id: address.id,
                  countryCode: address.countryCode,
                  governorate: address.governorate,
                  wilayat: address.wilayat,
                  city: address.city,
                  area: address.area,
                  street: address.street,
                  buildingNumber: address.buildingNumber,
                  postalCode: address.postalCode,
                }
              : null,
            profile: profile
              ? {
                  landAreaSquareMeters: profile.landAreaSquareMeters,
                  builtUpAreaSquareMeters: profile.builtUpAreaSquareMeters,
                  floorsCount: profile.floorsCount,
                  parkingSpaces: profile.parkingSpaces,
                  furnishing: profile.furnishing,
                  yearBuilt: profile.yearBuilt,
                }
              : null,
            units: unitRows
              .filter((unit) => unit.propertyId === property.id)
              .map((unit) => ({
                id: unit.id,
                code: unit.code,
                nameAr: unit.nameAr,
                nameEn: unit.nameEn,
                status: unit.status,
                listingPurpose: unit.listingPurpose,
                bedrooms: unit.bedrooms,
                bathrooms: unit.bathrooms,
                rentMinor: serializeMoney(unit.rentMinor),
                salePriceMinor: serializeMoney(unit.salePriceMinor),
                depositMinor: serializeMoney(unit.depositMinor),
                currency: unit.currency,
              })),
          };
        });
      }

      if (hasPermission(claims, 'party.read')) {
        const partyRows = await transaction
          .select()
          .from(parties)
          .where(eq(parties.organizationId, organizationId))
          .orderBy(asc(parties.createdAt));
        const partyIds = partyRows.map((row) => row.id);
        const [roles, linkedAddresses] = await Promise.all([
          partyIds.length
            ? transaction
                .select()
                .from(partyRoles)
                .where(
                  and(
                    eq(partyRoles.organizationId, organizationId),
                    inArray(partyRoles.partyId, partyIds),
                  ),
                )
            : Promise.resolve([]),
          partyIds.length
            ? transaction
                .select({
                  partyId: partyAddresses.partyId,
                  label: partyAddresses.label,
                  primary: partyAddresses.primary,
                  address: addresses,
                })
                .from(partyAddresses)
                .innerJoin(addresses, eq(addresses.id, partyAddresses.addressId))
                .where(inArray(partyAddresses.partyId, partyIds))
            : Promise.resolve([]),
        ]);
        snapshot.parties = partyRows.map((party) => ({
          id: party.id,
          type: party.type,
          displayName: party.displayName,
          email: party.email,
          phone: party.phone,
          status: party.status,
          roles: roles.filter((role) => role.partyId === party.id).map((role) => role.roleKey),
          addresses: linkedAddresses
            .filter((row) => row.partyId === party.id)
            .map((row) => ({
              label: row.label,
              primary: row.primary,
              countryCode: row.address.countryCode,
              governorate: row.address.governorate,
              wilayat: row.address.wilayat,
              city: row.address.city,
              area: row.address.area,
              street: row.address.street,
              buildingNumber: row.address.buildingNumber,
              postalCode: row.address.postalCode,
            })),
          ...(hasPermission(claims, 'party.sensitive.read')
            ? { hasNationalId: Boolean(party.nationalIdEncrypted) }
            : {}),
        }));
      }

      if (hasPermission(claims, 'lease.read')) {
        const leaseRows = await transaction
          .select()
          .from(leases)
          .where(eq(leases.organizationId, organizationId))
          .orderBy(desc(leases.createdAt))
          .limit(5_000);
        snapshot.leases = leaseRows.map((lease) => ({
          id: lease.id,
          unitId: lease.unitId,
          contractId: lease.contractId,
          tenantPartyId: lease.tenantPartyId,
          ownerPartyId: lease.ownerPartyId,
          status: lease.status,
          startsOn: lease.startsOn,
          endsOn: lease.endsOn,
          rentMinor: serializeMoney(lease.rentMinor),
          depositMinor: serializeMoney(lease.depositMinor),
          currency: lease.currency,
          billingDay: lease.billingDay,
        }));
      }

      if (hasPermission(claims, 'invoice.read')) {
        const invoiceRows = await transaction
          .select()
          .from(invoices)
          .where(eq(invoices.organizationId, organizationId))
          .orderBy(desc(invoices.issuedOn))
          .limit(5_000);
        snapshot.invoices = invoiceRows.map((invoice) => ({
          id: invoice.id,
          leaseId: invoice.leaseId,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          issuedOn: invoice.issuedOn,
          dueOn: invoice.dueOn,
          currency: invoice.currency,
          subtotalMinor: serializeMoney(invoice.subtotalMinor),
          taxMinor: serializeMoney(invoice.taxMinor),
          totalMinor: serializeMoney(invoice.totalMinor),
          paidMinor: serializeMoney(invoice.paidMinor),
        }));
      }

      if (hasPermission(claims, 'payment.read')) {
        const paymentRows = await transaction
          .select()
          .from(payments)
          .where(eq(payments.organizationId, organizationId))
          .orderBy(desc(payments.receivedAt))
          .limit(5_000);
        snapshot.payments = paymentRows.map((payment) => ({
          id: payment.id,
          invoiceId: payment.invoiceId,
          status: payment.status,
          method: payment.method,
          provider: payment.provider,
          amountMinor: serializeMoney(payment.amountMinor),
          currency: payment.currency,
          receivedAt: payment.receivedAt?.toISOString() ?? null,
          direction: 'inbound',
        }));
      }

      if (hasPermission(claims, 'receipt.read')) {
        const receiptRows = await transaction
          .select()
          .from(receipts)
          .where(eq(receipts.organizationId, organizationId))
          .orderBy(desc(receipts.issuedAt))
          .limit(5_000);
        snapshot.receipts = receiptRows.map((receipt) => ({
          id: receipt.id,
          paymentId: receipt.paymentId,
          receiptNumber: receipt.receiptNumber,
          issuedAt: receipt.issuedAt.toISOString(),
          amountMinor: serializeMoney(receipt.amountMinor),
          currency: receipt.currency,
        }));
      }

      if (hasPermission(claims, 'accounting.read')) {
        const [accounts, journals, expenseRows] = await Promise.all([
          transaction
            .select()
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.organizationId, organizationId))
            .orderBy(asc(ledgerAccounts.code)),
          transaction
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.organizationId, organizationId))
            .orderBy(desc(journalEntries.occurredOn))
            .limit(5_000),
          transaction
            .select()
            .from(expenses)
            .where(eq(expenses.organizationId, organizationId))
            .orderBy(desc(expenses.issuedOn))
            .limit(5_000),
        ]);
        const journalIds = journals.map((row) => row.id);
        const lines = journalIds.length
          ? await transaction
              .select()
              .from(journalLines)
              .where(inArray(journalLines.journalEntryId, journalIds))
          : [];
        snapshot.accounts = accounts.map((account) => ({
          id: account.id,
          code: account.code,
          nameAr: account.nameAr,
          nameEn: account.nameEn,
          type: account.type,
          currency: account.currency,
          active: account.active,
        }));
        snapshot.journals = journals.map((journal) => ({
          id: journal.id,
          reference: journal.reference,
          occurredOn: journal.occurredOn,
          description: journal.description,
          status: journal.status,
          sourceType: journal.sourceType,
          sourceId: journal.sourceId,
          lines: lines
            .filter((line) => line.journalEntryId === journal.id)
            .map((line) => ({
              accountId: line.accountId,
              partyId: line.partyId,
              propertyId: line.propertyId,
              unitId: line.unitId,
              debitMinor: serializeMoney(line.debitMinor),
              creditMinor: serializeMoney(line.creditMinor),
              currency: line.currency,
              memo: line.memo,
            })),
        }));
        snapshot.expenses = expenseRows.map((expense) => ({
          id: expense.id,
          propertyId: expense.propertyId,
          unitId: expense.unitId,
          vendorId: expense.vendorId,
          category: expense.category,
          description: expense.description,
          status: expense.status,
          amountMinor: serializeMoney(expense.amountMinor),
          taxMinor: serializeMoney(expense.taxMinor),
          currency: expense.currency,
          issuedOn: expense.issuedOn,
          dueOn: expense.dueOn,
          direction: 'outbound',
        }));
      }

      if (hasPermission(claims, 'stay.booking.read')) {
        const bookingRows = await transaction
          .select()
          .from(stayBookings)
          .where(eq(stayBookings.organizationId, organizationId))
          .orderBy(desc(stayBookings.createdAt))
          .limit(5_000);
        const bookingIds = bookingRows.map((row) => row.id);
        const guests = bookingIds.length
          ? await transaction
              .select()
              .from(stayBookingGuests)
              .where(inArray(stayBookingGuests.bookingId, bookingIds))
          : [];
        snapshot.stayBookings = bookingRows.map((booking) => {
          const primaryGuest =
            guests.find((guest) => guest.bookingId === booking.id && guest.isPrimary) ??
            guests.find((guest) => guest.bookingId === booking.id);
          return {
            id: booking.id,
            referenceCode: booking.referenceCode,
            propertyId: booking.propertyId,
            unitId: booking.unitId,
            status: booking.status,
            checkInOn: booking.checkInOn,
            checkOutOn: booking.checkOutOn,
            guestName: primaryGuest?.displayName ?? null,
            currency: booking.currency,
            subtotalMinor: serializeMoney(booking.subtotalMinor),
            feesMinor: serializeMoney(booking.feesMinor),
            taxMinor: serializeMoney(booking.taxMinor),
            totalMinor: serializeMoney(booking.totalMinor),
            createdAt: booking.createdAt.toISOString(),
          };
        });
      }

      return snapshot;
    });
  }

  private publicConnection(row: typeof hisabyLinks.$inferSelect) {
    return {
      linked: row.status === 'active',
      status: row.status,
      eventsUrl: row.eventsUrl,
      hisabyCompanyId: row.hisabyCompanyId,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: row.lastSyncStatus,
      lastSyncError: row.lastSyncError,
      exportPath: '/v1/integrations/hisaby/export',
      syncMode: 'push_and_pull',
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private markSync(organizationId: string, status: 'ok' | 'failed', error: string | null) {
    return this.database.asSystem(async (transaction) => {
      await ensureHisabyLinksTable(transaction);
      await transaction
        .update(hisabyLinks)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: status,
          lastSyncError: error,
          updatedAt: new Date(),
        })
        .where(eq(hisabyLinks.organizationId, organizationId));
    });
  }
}
