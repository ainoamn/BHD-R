import 'server-only';
import { sql } from 'drizzle-orm';

type Executable = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

export const OFFERING_MODE_VALUES = ['sale', 'monthly', 'yearly', 'daily'] as const;
export type OfferingMode = (typeof OFFERING_MODE_VALUES)[number];

export async function ensureUnitOfferingModesColumn(transaction: Executable): Promise<void> {
  await transaction.execute(sql`
    ALTER TABLE "units"
    ADD COLUMN IF NOT EXISTS "offering_modes" varchar(64) NOT NULL DEFAULT 'monthly'
  `);
}

export function parseOfferingModes(raw: string | null | undefined): OfferingMode[] {
  const parts = String(raw ?? 'monthly')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is OfferingMode =>
      (OFFERING_MODE_VALUES as readonly string[]).includes(part),
    );
  return parts.length ? [...new Set(parts)] : ['monthly'];
}

export function serializeOfferingModes(modes: OfferingMode[]): string {
  const unique = OFFERING_MODE_VALUES.filter((mode) => modes.includes(mode));
  return unique.length ? unique.join(',') : 'monthly';
}

export function isDailyOnlyOffering(modes: OfferingMode[]): boolean {
  return (
    modes.includes('daily') &&
    !modes.some((mode) => mode === 'monthly' || mode === 'yearly' || mode === 'sale')
  );
}

export function hasLongTermCatalogueOffer(modes: OfferingMode[]): boolean {
  return modes.some((mode) => mode === 'monthly' || mode === 'yearly' || mode === 'sale');
}

/** Map offering modes onto legacy listingPurpose column. */
export function listingPurposeFromOfferingModes(modes: OfferingMode[]): 'rent' | 'sale' | 'both' {
  const sale = modes.includes('sale');
  const rent = modes.includes('monthly') || modes.includes('yearly') || modes.includes('daily');
  if (sale && rent) return 'both';
  if (sale) return 'sale';
  return 'rent';
}

export function offeringModesFromListingPurpose(
  purpose: 'rent' | 'sale' | 'both' | undefined,
): OfferingMode[] {
  if (purpose === 'sale') return ['sale'];
  if (purpose === 'both') return ['monthly', 'sale'];
  return ['monthly'];
}
