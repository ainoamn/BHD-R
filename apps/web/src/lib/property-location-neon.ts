import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { addresses, properties, propertyProfiles, type Database } from '@bhd-r/db';
import type { PropertyLocation } from '@/lib/contract-document';
import { contractQrSvg } from '@/lib/contract-verify';
import { googleMapsLinkFromCoords, parseGoogleMapsUrl } from '@/lib/parse-google-maps-url';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** The "Google Maps: …" link the property wizard keeps in the profile notes. */
function notedMapsUrl(notes: string | null): string | null {
  const raw = notes?.match(/Google Maps:\s*(https?:\/\/\S+)/i)?.[1]?.replace(/[.,;]+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Location printed on contracts and bookings: the pin from the address, else the owner's
 * saved Google Maps link (pinned when it carries coordinates). Null when neither exists.
 */
export async function loadPropertyLocation(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  propertyId: string,
): Promise<PropertyLocation | null> {
  const [row] = await tx
    .select({
      latitude: sql<
        number | string | null
      >`case when ${addresses.location} is not null then ST_Y(${addresses.location}::geometry) end`,
      longitude: sql<
        number | string | null
      >`case when ${addresses.location} is not null then ST_X(${addresses.location}::geometry) end`,
      notes: propertyProfiles.notes,
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
    .where(and(eq(properties.organizationId, orgId), eq(properties.id, propertyId)))
    .limit(1);
  if (!row) return null;

  let latitude = coordinate(row.latitude, 90);
  let longitude = coordinate(row.longitude, 180);
  const noted = notedMapsUrl(row.notes);
  if ((latitude === null || longitude === null) && noted) {
    const parsed = parseGoogleMapsUrl(noted);
    latitude = parsed?.latitude ?? null;
    longitude = parsed?.longitude ?? null;
  }
  const pin = latitude !== null && longitude !== null ? { latitude, longitude } : null;
  const mapsUrl = pin ? googleMapsLinkFromCoords(pin.latitude, pin.longitude) : noted;
  if (!mapsUrl) return null;
  return {
    latitude: pin?.latitude ?? null,
    longitude: pin?.longitude ?? null,
    mapsUrl,
    qrSvg: await contractQrSvg(mapsUrl).catch(() => null),
  };
}
