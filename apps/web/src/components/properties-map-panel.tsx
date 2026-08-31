'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import type { CatalogueListing } from '@/lib/listing-market-status';
import { formatMoney, localizedName } from '@/lib/format';

export function PropertiesMapPanel({
  open,
  locale,
  listings,
  selectedId,
  onSelect,
  onClose,
}: {
  open: boolean;
  locale: string;
  listings: CatalogueListing[];
  selectedId: string | null;
  onSelect: (listing: CatalogueListing) => void;
  onClose: () => void;
}) {
  const ar = locale === 'ar';
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());

  const pinned = useMemo(
    () =>
      listings.filter(
        (item) =>
          typeof item.latitude === 'number' &&
          typeof item.longitude === 'number' &&
          Number.isFinite(item.latitude) &&
          Number.isFinite(item.longitude),
      ),
    [listings],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapNode.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current.clear();
      }

      const center: [number, number] =
        pinned[0] && pinned[0].latitude != null && pinned[0].longitude != null
          ? [pinned[0].latitude, pinned[0].longitude]
          : [23.588, 58.3829];

      const map = L.map(mapNode.current, {
        center,
        zoom: pinned.length ? 12 : 10,
        scrollWheelZoom: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;

      const bounds: [number, number][] = [];
      for (const listing of pinned) {
        const lat = listing.latitude!;
        const lng = listing.longitude!;
        bounds.push([lat, lng]);
        const price =
          listing.listingPurpose === 'sale' && listing.salePrice
            ? formatMoney(listing.salePrice.amountMinor, listing.salePrice.currency, locale)
            : formatMoney(listing.rent.amountMinor, listing.rent.currency, locale);
        const title = localizedName(locale, listing.propertyNameAr, listing.propertyNameEn);
        const icon = L.divIcon({
          className: `props-map-pin${selectedId === listing.id ? ' is-active' : ''}`,
          html: `<span>${price}</span>`,
          iconSize: [72, 28],
          iconAnchor: [36, 28],
        });
        const marker = L.marker([lat, lng], { icon }).addTo(map);
        marker.bindPopup(`<strong>${title}</strong><br/>${price}`);
        marker.on('click', () => onSelect(listing));
        markersRef.current.set(listing.id, marker);
      }
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40] });
      } else if (bounds.length === 1) {
        map.setView(bounds[0]!, 15);
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current.clear();
      }
    };
  }, [open, pinned, locale, onSelect, selectedId]);

  useEffect(() => {
    if (!open || !mapRef.current) return;
    for (const [id, marker] of markersRef.current) {
      const el = marker.getElement();
      if (el) el.classList.toggle('is-active', id === selectedId);
    }
    const selected = pinned.find((item) => item.id === selectedId);
    if (selected?.latitude != null && selected.longitude != null) {
      mapRef.current.panTo([selected.latitude, selected.longitude]);
    }
  }, [selectedId, open, pinned]);

  if (!open) return null;

  return (
    <div className="props-map-overlay" role="dialog" aria-modal="true" aria-label={ar ? 'الخريطة' : 'Map'}>
      <div className="props-map-overlay__toolbar">
        <div>
          <strong>{ar ? 'اعرض على الخريطة' : 'Show on map'}</strong>
          <p>
            {ar
              ? `${pinned.length} عقار بموقع محفوظ · ${listings.length - pinned.length} بدون إحداثيات`
              : `${pinned.length} with saved location · ${listings.length - pinned.length} without coords`}
          </p>
        </div>
        <button type="button" className="button button--secondary" onClick={onClose}>
          {ar ? 'إغلاق الخريطة' : 'Close map'}
        </button>
      </div>
      <div className="props-map-overlay__body">
        <div ref={mapNode} className="props-map-overlay__canvas" />
        <aside className="props-map-overlay__list">
          {listings.map((listing) => {
            const title = localizedName(locale, listing.propertyNameAr, listing.propertyNameEn);
            const hasPin =
              typeof listing.latitude === 'number' && typeof listing.longitude === 'number';
            return (
              <button
                key={listing.id}
                type="button"
                className={
                  selectedId === listing.id
                    ? 'props-map-card is-active'
                    : 'props-map-card'
                }
                onClick={() => onSelect(listing)}
              >
                <strong>{title}</strong>
                <span>
                  {listing.governorate}
                  {listing.wilayat ? ` · ${listing.wilayat}` : ''}
                </span>
                {!hasPin ? (
                  <em>{ar ? 'بدون موقع على الخريطة' : 'No map pin'}</em>
                ) : null}
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
