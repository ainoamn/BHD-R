import type { PropertyLocation } from '@/lib/contract-document';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';
const ZOOM = 16;
const TILE = 256;
const TILE_ORIGIN = 'https://tile.openstreetmap.org';

/**
 * OpenStreetMap tiles around the pin, positioned from the map's centre so the pin sits in
 * the middle at any width up to 1024px. Plain images: no script, and they print.
 */
function tilesAround(latitude: number, longitude: number) {
  const count = 2 ** ZOOM;
  const radians = (latitude * Math.PI) / 180;
  const x = ((longitude + 180) / 360) * count;
  const y = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * count;
  const tiles: Array<{ key: string; src: string; left: number; top: number }> = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      const tileX = Math.floor(x) + column;
      const tileY = Math.floor(y) + row;
      if (tileY < 0 || tileY >= count) continue;
      const wrappedX = ((tileX % count) + count) % count;
      tiles.push({
        key: `${tileX}:${tileY}`,
        src: `${TILE_ORIGIN}/${ZOOM}/${wrappedX}/${tileY}.png`,
        left: Math.round((tileX - x) * TILE),
        top: Math.round((tileY - y) * TILE),
      });
    }
  }
  return tiles;
}

/**
 * The property's map with the BHD mark as a watermark, and beside it a QR code (BHD mark in
 * the middle) that opens the location. `bilingual` prints both languages, as contracts do.
 */
export function PropertyLocationMap({
  location,
  locale,
  bilingual = false,
}: {
  location: PropertyLocation;
  locale: string;
  bilingual?: boolean;
}) {
  const ar = locale === 'ar';
  const text = (arabic: string, english: string) =>
    bilingual ? (
      <>
        <span lang="ar">{arabic}</span>
        <span lang="en">{english}</span>
      </>
    ) : (
      <span>{ar ? arabic : english}</span>
    );
  const pin =
    location.latitude !== null && location.longitude !== null
      ? { latitude: location.latitude, longitude: location.longitude }
      : null;

  return (
    <figure className={`loc-map${pin ? '' : ' loc-map--qr-only'}`}>
      {pin ? (
        <a
          className="loc-map__map"
          href={location.mapsUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={ar ? 'فتح موقع العقار في الخرائط' : 'Open the property location in Maps'}
        >
          <span className="loc-map__tiles" aria-hidden="true">
            {tilesAround(pin.latitude, pin.longitude).map((tile) => (
              <img
                key={tile.key}
                src={tile.src}
                alt=""
                width={TILE}
                height={TILE}
                decoding="async"
                style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
              />
            ))}
          </span>
          <span className="loc-map__veil" aria-hidden="true" />
          <img className="loc-map__watermark" src={BRAND_LOGO} alt="" aria-hidden="true" />
          <span className="loc-map__pin" aria-hidden="true">
            <span className="loc-map__pulse" />
            <svg viewBox="0 0 40 52" width="40" height="52">
              <path
                d="M20 51C20 51 37 31.5 37 19A17 17 0 0 0 3 19c0 12.5 17 32 17 32Z"
                fill="#0b3d2a"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <circle cx="20" cy="19" r="10.5" fill="#ffffff" />
              <path d="M14.5 20.5 20 15.5l5.5 5v5.5h-11Z" fill="#08a39f" />
              <rect x="18.3" y="22" width="3.4" height="4" fill="#ffffff" />
            </svg>
          </span>
          <span className="loc-map__brand" aria-hidden="true">
            <img src={BRAND_LOGO} alt="" width="54" height="17" />
            <i>R</i>
          </span>
          <span className="loc-map__attrib" dir="ltr">
            © OpenStreetMap
          </span>
        </a>
      ) : null}
      {location.qrSvg ? (
        <a
          className="loc-map__qr"
          href={location.mapsUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={ar ? 'رمز موقع العقار' : 'Property location code'}
        >
          <span className="loc-map__qr-code" dangerouslySetInnerHTML={{ __html: location.qrSvg }} />
          <small>{text('امسح لفتح موقع العقار', 'Scan to open the location')}</small>
        </a>
      ) : null}
      <figcaption className="loc-map__caption">
        <strong>{text('موقع العقار', 'Property location')}</strong>
        {pin ? (
          <bdi dir="ltr">
            {pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}
          </bdi>
        ) : null}
        <a href={location.mapsUrl} target="_blank" rel="noreferrer">
          {text('فتح في خرائط Google', 'Open in Google Maps')}
        </a>
      </figcaption>
    </figure>
  );
}
