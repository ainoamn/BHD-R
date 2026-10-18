'use client';

import { useEffect, useMemo, useState } from 'react';

export type DimensionProperty = { id: string; nameAr: string; nameEn: string };
export type DimensionUnit = {
  id: string;
  propertyId: string;
  code: string;
  nameAr: string;
  nameEn: string;
};

type Dimensions = { properties: DimensionProperty[]; units: DimensionUnit[] };

let cached: Dimensions | null = null;
let inflight: Promise<Dimensions> | null = null;

async function loadDimensions(): Promise<Dimensions> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch('/api/owner/accounting/dimensions', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return { properties: [], units: [] };
        const payload = (await response.json()) as Dimensions;
        cached = {
          properties: payload.properties ?? [],
          units: payload.units ?? [],
        };
        return cached;
      })
      .catch(() => ({ properties: [], units: [] }))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Property + unit selects that load the viewer's buildings automatically. */
export function AccountingPropertyUnitFields({
  locale,
  propertyId,
  unitId,
  onChange,
  required = false,
}: {
  locale: 'ar' | 'en';
  propertyId: string;
  unitId: string;
  onChange: (next: { propertyId: string; unitId: string }) => void;
  required?: boolean;
}) {
  const ar = locale === 'ar';
  const [dims, setDims] = useState<Dimensions>(cached ?? { properties: [], units: [] });

  useEffect(() => {
    let cancelled = false;
    void loadDimensions().then((next) => {
      if (!cancelled) setDims(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const units = useMemo(
    () =>
      propertyId ? dims.units.filter((unit) => unit.propertyId === propertyId) : dims.units,
    [dims.units, propertyId],
  );

  return (
    <>
      <label>
        {ar ? 'المبنى' : 'Property'}
        <select
          value={propertyId}
          required={required}
          onChange={(event) => {
            const nextProperty = event.target.value;
            const unitStillValid = dims.units.some(
              (unit) => unit.id === unitId && unit.propertyId === nextProperty,
            );
            onChange({
              propertyId: nextProperty,
              unitId: unitStillValid ? unitId : '',
            });
          }}
        >
          <option value="">{ar ? '— اختياري —' : '— optional —'}</option>
          {dims.properties.map((property) => (
            <option key={property.id} value={property.id}>
              {ar ? property.nameAr : property.nameEn}
            </option>
          ))}
        </select>
      </label>
      <label>
        {ar ? 'الوحدة' : 'Unit'}
        <select
          value={unitId}
          disabled={!propertyId && dims.units.length > 40}
          onChange={(event) => {
            const nextUnit = event.target.value;
            const match = dims.units.find((unit) => unit.id === nextUnit);
            onChange({
              propertyId: match?.propertyId || propertyId,
              unitId: nextUnit,
            });
          }}
        >
          <option value="">{ar ? '— اختياري —' : '— optional —'}</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.code}
              {unit.nameAr || unit.nameEn
                ? ` · ${ar ? unit.nameAr || unit.nameEn : unit.nameEn || unit.nameAr}`
                : ''}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
