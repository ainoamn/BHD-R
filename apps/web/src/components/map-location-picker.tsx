'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@bhd-r/ui';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import {
  googleMapsLinkFromCoords,
  type MapCoordinates,
} from '@/lib/parse-google-maps-url';

const MUSCAT: MapCoordinates = { latitude: 23.588, longitude: 58.3829 };

export function MapLocationPicker({
  open,
  locale,
  initial,
  onClose,
  onConfirm,
  labels,
}: {
  open: boolean;
  locale: 'ar' | 'en';
  initial?: MapCoordinates | null;
  onClose: () => void;
  onConfirm: (coords: MapCoordinates, mapsUrl: string) => void;
  labels: {
    title: string;
    hint: string;
    searchPlaceholder: string;
    search: string;
    confirm: string;
    cancel: string;
    coords: string;
  };
}) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const [draft, setDraft] = useState<MapCoordinates | null>(initial ?? null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial ?? MUSCAT);
    setQuery('');
    setSearchError(null);
  }, [open, initial]);

  useEffect(() => {
    if (!open || !mapNode.current) return;
    let cancelled = false;
    const start = initial ?? MUSCAT;

    void (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapNode.current) return;

      const map = L.map(mapNode.current, {
        center: [start.latitude, start.longitude],
        zoom: initial ? 16 : 12,
        scrollWheelZoom: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const pin = L.divIcon({
        className: 'map-picker__pin',
        html: '<span></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      const marker = L.marker([start.latitude, start.longitude], {
        draggable: true,
        icon: pin,
      }).addTo(map);

      const publish = (latitude: number, longitude: number) => {
        setDraft({ latitude, longitude });
      };

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        publish(pos.lat, pos.lng);
      });
      map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
        marker.setLatLng(event.latlng);
        publish(event.latlng.lat, event.latlng.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
      publish(start.latitude, start.longitude);
      requestAnimationFrame(() => map.invalidateSize());
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Intentionally only when dialog opens — initial is snapshotted once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !draft || !mapRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([draft.latitude, draft.longitude]);
  }, [draft, open]);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'om');
      url.searchParams.set('q', q);
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('search_failed');
      const rows = (await response.json()) as Array<{ lat: string; lon: string }>;
      const hit = rows[0];
      if (!hit) {
        setSearchError(locale === 'ar' ? 'لم يُعثر على الموقع' : 'No place found');
        return;
      }
      const next = {
        latitude: Number(hit.lat),
        longitude: Number(hit.lon),
      };
      setDraft(next);
      mapRef.current?.setView([next.latitude, next.longitude], 16);
      markerRef.current?.setLatLng([next.latitude, next.longitude]);
    } catch {
      setSearchError(locale === 'ar' ? 'تعذّر البحث حالياً' : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  if (!open) return null;

  return (
    <div className="map-picker" role="dialog" aria-modal="true" aria-label={labels.title}>
      <button type="button" className="map-picker__backdrop" aria-label={labels.cancel} onClick={onClose} />
      <div className="map-picker__panel">
        <header className="map-picker__head">
          <h2>{labels.title}</h2>
          <p>{labels.hint}</p>
        </header>
        <div className="map-picker__search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runSearch();
              }
            }}
            placeholder={labels.searchPlaceholder}
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
          />
          <Button type="button" variant="quiet" disabled={searching} onClick={() => void runSearch()}>
            {searching ? '…' : labels.search}
          </Button>
        </div>
        {searchError ? <p className="field__error">{searchError}</p> : null}
        <div ref={mapNode} className="map-picker__map" />
        {draft ? (
          <p className="map-picker__coords" dir="ltr">
            {labels.coords}: {draft.latitude.toFixed(6)}, {draft.longitude.toFixed(6)}
          </p>
        ) : null}
        <div className="map-picker__actions">
          <Button type="button" variant="quiet" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={!draft}
            onClick={() => {
              if (!draft) return;
              onConfirm(draft, googleMapsLinkFromCoords(draft.latitude, draft.longitude));
            }}
          >
            {labels.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
