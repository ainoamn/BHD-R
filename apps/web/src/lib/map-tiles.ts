/**
 * Raster basemap tiles. OSM.org and CARTO public CDNs block or require keys for
 * production sites, so we use Esri's publicly available World Street Map XYZ layer
 * (z/y/x). Attribution must remain visible.
 */
export const MAP_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

/** Leaflet still accepts this; Esri URLs have no subdomain rotation. */
export const MAP_TILE_SUBDOMAINS = 'abcd';

export const MAP_TILE_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Source: Esri, OpenStreetMap';

/** Static image URL for a single tile (no Leaflet). Esri order is z/y/x. */
export function mapTileSrc(z: number, x: number, y: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
}
