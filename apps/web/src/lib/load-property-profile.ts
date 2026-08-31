import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { propertyProfiles } from '@bhd-r/db';
import { ensurePropertyProfileListingColumns } from '@/lib/ensure-property-profile-columns';

/** Columns that existed before migration 0017 (safe to SELECT without the new flag). */
const profileBaseSelect = {
  id: propertyProfiles.id,
  organizationId: propertyProfiles.organizationId,
  propertyId: propertyProfiles.propertyId,
  deedNumber: propertyProfiles.deedNumber,
  plotNumber: propertyProfiles.plotNumber,
  municipalityNumber: propertyProfiles.municipalityNumber,
  electricityAccountNumber: propertyProfiles.electricityAccountNumber,
  waterAccountNumber: propertyProfiles.waterAccountNumber,
  landAreaSquareMeters: propertyProfiles.landAreaSquareMeters,
  builtUpAreaSquareMeters: propertyProfiles.builtUpAreaSquareMeters,
  yearBuilt: propertyProfiles.yearBuilt,
  floorsCount: propertyProfiles.floorsCount,
  parkingSpaces: propertyProfiles.parkingSpaces,
  furnishing: propertyProfiles.furnishing,
  managementStartedOn: propertyProfiles.managementStartedOn,
  managementFeeMinor: propertyProfiles.managementFeeMinor,
  notes: propertyProfiles.notes,
  createdAt: propertyProfiles.createdAt,
  updatedAt: propertyProfiles.updatedAt,
} as const;

export type LoadedPropertyProfile = {
  id: string;
  organizationId: string;
  propertyId: string;
  deedNumber: string | null;
  plotNumber: string | null;
  municipalityNumber: string | null;
  electricityAccountNumber: string | null;
  waterAccountNumber: string | null;
  landAreaSquareMeters: string | null;
  builtUpAreaSquareMeters: string | null;
  yearBuilt: number | null;
  floorsCount: number | null;
  parkingSpaces: number | null;
  furnishing: string;
  managementStartedOn: string | null;
  managementFeeMinor: bigint | null;
  notes: string | null;
  showOwnerNameOnListing: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Load property profile without crashing when migration 0017 is not applied yet.
 * Best-effort ADD COLUMN, then safe SELECT + optional flag read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPropertyProfileRow(
  transaction: any,
  propertyId: string,
): Promise<LoadedPropertyProfile | null> {
  await ensurePropertyProfileListingColumns(transaction).catch(() => undefined);

  const rows = await transaction
    .select(profileBaseSelect)
    .from(propertyProfiles)
    .where(eq(propertyProfiles.propertyId, propertyId))
    .limit(1);
  const row = rows[0] as Omit<LoadedPropertyProfile, 'showOwnerNameOnListing'> | undefined;
  if (!row) return null;

  let showOwnerNameOnListing = false;
  try {
    const flagRows = (await transaction.execute(sql`
      select show_owner_name_on_listing as v
      from property_profiles
      where property_id = ${propertyId}
      limit 1
    `)) as Array<{ v?: boolean | null }>;
    showOwnerNameOnListing = Boolean(flagRows?.[0]?.v);
  } catch {
    showOwnerNameOnListing = false;
  }

  return { ...row, showOwnerNameOnListing };
}

/** Persist profile fields; owner-name flag is best-effort until migration 0017 lands. */
export async function writePropertyProfileRow(
  transaction: any,
  args: {
    organizationId: string;
    propertyId: string;
    existingId?: string | null;
    profile: Record<string, unknown> & {
      managementFee?: { amountMinor: string; currency: string } | undefined;
      showOwnerNameOnListing?: boolean | undefined;
    };
  },
): Promise<void> {
  await ensurePropertyProfileListingColumns(transaction).catch(() => undefined);

  const { managementFee, showOwnerNameOnListing, ...profileFields } = args.profile;
  const baseValues = {
    ...profileFields,
    managementFeeMinor: managementFee ? BigInt(managementFee.amountMinor) : null,
    updatedAt: new Date(),
  };

  if (args.existingId) {
    await transaction
      .update(propertyProfiles)
      .set(baseValues)
      .where(eq(propertyProfiles.id, args.existingId));
  } else {
    await transaction.insert(propertyProfiles).values({
      organizationId: args.organizationId,
      propertyId: args.propertyId,
      ...profileFields,
      managementFeeMinor: managementFee ? BigInt(managementFee.amountMinor) : null,
    });
  }

  if (typeof showOwnerNameOnListing === 'boolean') {
    try {
      await transaction.execute(sql`
        update property_profiles
        set show_owner_name_on_listing = ${showOwnerNameOnListing},
            updated_at = now()
        where property_id = ${args.propertyId}
      `);
    } catch {
      // Column still missing and role cannot ALTER — ignore; listing stays private-name.
    }
  }
}
