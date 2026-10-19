'use client';

import { useEffect, useMemo, useState } from 'react';

export type DimensionProperty = {
  id: string;
  nameAr: string;
  nameEn: string;
  serial?: string | null;
  place?: string | null;
  ownerPartyId?: string;
  ownerName?: string;
};
export type DimensionUnit = {
  id: string;
  propertyId: string;
  code: string;
  nameAr: string;
  nameEn: string;
};
export type DimensionTenant = {
  partyId: string;
  name: string;
  propertyId: string;
  unitId: string | null;
};

type Dimensions = {
  properties: DimensionProperty[];
  units: DimensionUnit[];
  tenants: DimensionTenant[];
};

export type DimensionLink = 'property' | 'tenant' | 'owner';

export type DimensionPick = {
  propertyId: string;
  unitId: string;
  partyId: string;
};

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
        if (!response.ok) return { properties: [], units: [], tenants: [] };
        const payload = (await response.json()) as Dimensions;
        cached = {
          properties: payload.properties ?? [],
          units: payload.units ?? [],
          tenants: payload.tenants ?? [],
        };
        return cached;
      })
      .catch(() => ({ properties: [], units: [], tenants: [] }))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function haystack(property: DimensionProperty, units: DimensionUnit[], tenants: DimensionTenant[]) {
  const bits = [
    property.nameAr,
    property.nameEn,
    property.serial,
    property.place,
    property.ownerName,
    ...units.filter((unit) => unit.propertyId === property.id).flatMap((unit) => [unit.code, unit.nameAr, unit.nameEn]),
    ...tenants.filter((tenant) => tenant.propertyId === property.id).map((tenant) => tenant.name),
  ];
  return bits.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Keyword search for a building, then unit. Expense/income can also link the
 * entry to the property, its tenant, or its owner.
 */
export function AccountingPropertyUnitFields({
  locale,
  propertyId,
  unitId,
  partyId = '',
  linkTo = 'property',
  showLink = false,
  onChange,
  required = false,
}: {
  locale: 'ar' | 'en';
  propertyId: string;
  unitId: string;
  partyId?: string;
  linkTo?: DimensionLink;
  showLink?: boolean;
  onChange: (next: DimensionPick & { linkTo: DimensionLink }) => void;
  required?: boolean;
}) {
  const ar = locale === 'ar';
  const [dims, setDims] = useState<Dimensions>(
    cached ?? { properties: [], units: [], tenants: [] },
  );
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadDimensions().then((next) => {
      if (!cancelled) setDims(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const properties = useMemo(() => {
    if (!q) return dims.properties;
    return dims.properties.filter((property) =>
      haystack(property, dims.units, dims.tenants).includes(q),
    );
  }, [dims.properties, dims.tenants, dims.units, q]);

  const units = useMemo(
    () =>
      propertyId ? dims.units.filter((unit) => unit.propertyId === propertyId) : [],
    [dims.units, propertyId],
  );

  const tenants = useMemo(() => {
    const list = dims.tenants.filter((tenant) => tenant.propertyId === propertyId);
    return unitId ? list.filter((tenant) => !tenant.unitId || tenant.unitId === unitId) : list;
  }, [dims.tenants, propertyId, unitId]);

  const selected = dims.properties.find((property) => property.id === propertyId);

  function emit(next: Partial<DimensionPick> & { linkTo?: DimensionLink }) {
    const nextProperty = next.propertyId ?? propertyId;
    const nextUnit = next.unitId ?? (next.propertyId && next.propertyId !== propertyId ? '' : unitId);
    const nextLink = next.linkTo ?? linkTo;
    const building = dims.properties.find((property) => property.id === nextProperty);
    let nextParty = next.partyId ?? partyId;
    if (nextLink === 'owner') nextParty = building?.ownerPartyId ?? '';
    if (nextLink === 'property') nextParty = '';
    if (nextLink === 'tenant' && next.propertyId && next.propertyId !== propertyId) nextParty = '';
    onChange({
      propertyId: nextProperty,
      unitId: nextUnit,
      partyId: nextParty,
      linkTo: nextLink,
    });
  }

  return (
    <div className="accounting-hub__dims accounting-hub__dims--modal">
      <label className="accounting-hub__search">
        {ar ? 'بحث عن العقار' : 'Search property'}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            ar
              ? 'اسم، وحدة، مالك، مستأجر، موقع…'
              : 'Name, unit, owner, tenant, place…'
          }
        />
      </label>
      <div className="accounting-hub__dims-picks">
        <label>
          {ar ? 'العقار' : 'Property'}
          <select
            value={propertyId}
            required={required}
            onChange={(event) => emit({ propertyId: event.target.value, unitId: '' })}
          >
            <option value="">
              {q
                ? ar
                  ? `${properties.length} نتيجة`
                  : `${properties.length} matches`
                : ar
                  ? '— اختر بعد البحث —'
                  : '— pick after search —'}
            </option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {(ar ? property.nameAr : property.nameEn) +
                  (property.place ? ` · ${property.place}` : '') +
                  (property.serial ? ` · ${property.serial}` : '')}
              </option>
            ))}
          </select>
        </label>
        <label>
          {ar ? 'الوحدة — اختياري' : 'Unit — optional'}
          <select
            value={unitId}
            disabled={!propertyId}
            onChange={(event) => emit({ unitId: event.target.value })}
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
        {showLink ? (
          <label>
            {ar ? 'الربط العقاري' : 'Link to'}
            <select
              value={linkTo}
              onChange={(event) => emit({ linkTo: event.target.value as DimensionLink })}
            >
              <option value="property">{ar ? 'العقار' : 'The property'}</option>
              <option value="tenant">{ar ? 'مستأجر العقار' : 'Property tenant'}</option>
              <option value="owner">{ar ? 'المالك' : 'The owner'}</option>
            </select>
          </label>
        ) : null}
        {showLink && linkTo === 'tenant' ? (
          <label>
            {ar ? 'المستأجر' : 'Tenant'}
            <select
              value={partyId}
              onChange={(event) => emit({ partyId: event.target.value, linkTo: 'tenant' })}
              disabled={!propertyId}
            >
              <option value="">{ar ? '— اختر المستأجر —' : '— pick a tenant —'}</option>
              {tenants.map((tenant) => (
                <option key={`${tenant.partyId}-${tenant.unitId ?? ''}`} value={tenant.partyId}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {showLink && linkTo === 'owner' && selected?.ownerName ? (
        <p className="accounting-hub__hint">
          {ar ? 'المالك: ' : 'Owner: '}
          <bdi>{selected.ownerName}</bdi>
        </p>
      ) : null}
    </div>
  );
}
