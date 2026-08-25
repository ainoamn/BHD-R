/** Parse Google Maps share/place URLs (or bare lat,lng) into coordinates. */

export type MapCoordinates = { latitude: number; longitude: number };

function validCoords(latitude: number, longitude: number): MapCoordinates | null {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

export function parseGoogleMapsUrl(input: string): MapCoordinates | null {
  const raw = input.trim();
  if (!raw) return null;

  const bare = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (bare) return validCoords(Number(bare[1]), Number(bare[2]));

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const at = `${url.pathname}${url.search}${url.hash}`.match(
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  );
  if (at) return validCoords(Number(at[1]), Number(at[2]));

  const bang = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bang) return validCoords(Number(bang[1]), Number(bang[2]));

  for (const key of ['q', 'query', 'll']) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const pair = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (pair) return validCoords(Number(pair[1]), Number(pair[2]));
  }

  return null;
}

/** Embeddable map (no API key) centered on the pin. */
export function googleMapsEmbedSrc(latitude: number, longitude: number): string {
  const q = encodeURIComponent(`${latitude},${longitude}`);
  return `https://maps.google.com/maps?q=${q}&z=16&hl=ar&output=embed`;
}

/** Canonical Google Maps link stored with the property. */
export function googleMapsLinkFromCoords(latitude: number, longitude: number): string {
  const lat = Number(latitude.toFixed(6));
  const lng = Number(longitude.toFixed(6));
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
