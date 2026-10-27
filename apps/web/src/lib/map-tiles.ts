/**
 * Raster basemap tiles. OpenStreetMap's public tile CDN blocks production apps that
 * do not follow their volunteer-server policy (osm.wiki/Blocked), so we use CARTO's
 * OSM-derived basemaps instead.
 */
export const MAP_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

export const MAP_TILE_SUBDOMAINS = 'abcd';

export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Static PNG URL for a single tile (no Leaflet). */
export function mapTileSrc(z: number, x: number, y: number): string {
  const host = MAP_TILE_SUBDOMAINS[(x + y) % MAP_TILE_SUBDOMAINS.length] ?? 'a';
  return `https://${host}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
}
